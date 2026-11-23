-- 20261123105237_invitations.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp). Do not hand-edit
-- the version, and never edit a migration that has shipped.
--
-- What this migration does:
--   The hive owner invites a person by email. A person who already has an
--   account with a confirmed email address is added at once; anyone else gets
--   a pending invitation, honoured when they first sign in with that address.
--
--   - public.invitations: readable by the hive's owner only, never by an
--     agent. Nobody inserts, updates or deletes rows directly.
--   - invite_member, revoke_invitation: the hive's owner, signed in as a person.
--   - claim_invitations: a signed-in person joins every hive that invited
--     their own email address.
--
--   Nobody joins a hive unless auth.users.email_confirmed_at is set for them
--   and their email equals the invitation's after lower-casing. Agents and
--   self-hosted identities are refused by all three functions.
--   add_member stays as it is.

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  hive_id uuid not null references public.hives on delete cascade,
  -- Stored trimmed and lower-case; the claim matches it exactly.
  email text not null check (
    email = lower(email) and length(email) <= 254
    and email ~ '^[^@[:space:][:cntrl:]]+@[^@[:space:][:cntrl:]]+$'),
  display_name text not null check (
    length(display_name) between 1 and 60
    and display_name = btrim(display_name)
    and display_name !~ '[[:cntrl:]]'),
  invited_by uuid references public.members on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  accepted_member uuid references public.members on delete set null,
  revoked_at timestamptz
);
-- At most one pending invitation per hive and email, whoever asks and however
-- many calls arrive at once.
create unique index invitations_pending_idx on public.invitations (hive_id, email)
  where accepted_at is null and revoked_at is null;
-- What the claim reads by.
create index invitations_email_idx on public.invitations (email)
  where accepted_at is null and revoked_at is null;

alter table public.invitations enable row level security;
create policy invitations_select on public.invitations for select to authenticated
  using (public.is_hive_owner(hive_id)
         and public.jwt_agent_id() is null
         and not public.jwt_is_self_hosted());
revoke all on public.invitations from anon, authenticated;
grant select on public.invitations to authenticated;

-- Invite a person into a hive. Returns 'added' when a confirmed account with
-- that email exists (they are a member now), else 'invited'.
create function public.invite_member(p_hive uuid, p_email text, p_display_name text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_space constant text := E' \t\n\r\f\v';
  v_email text := lower(btrim(coalesce(p_email, ''), v_space));
  v_name text := btrim(coalesce(p_display_name, ''), v_space);
  v_me uuid;
  v_user uuid;
  v_member uuid;
  v_invitation uuid;
begin
  if public.jwt_agent_id() is not null or public.jwt_is_self_hosted()
     or not public.is_hive_owner(p_hive) then
    raise exception 'only the hive owner can invite members';
  end if;
  -- Checked here and not left to the table: the "added" path writes no
  -- invitation row, and a member's name has no check of its own.
  if length(v_email) > 254
     or v_email !~ '^[^@[:space:][:cntrl:]]+@[^@[:space:][:cntrl:]]+$' then
    raise exception 'enter a valid email address';
  end if;
  if length(v_name) not between 1 and 60 or v_name ~ '[[:cntrl:]]' then
    raise exception 'enter a name of 1 to 60 characters';
  end if;

  select m.id into v_me from public.members m
   where m.hive_id = p_hive and m.user_id = (select auth.uid());

  if exists (select 1 from public.members m join auth.users u on u.id = m.user_id
              where m.hive_id = p_hive and lower(u.email) = v_email) then
    raise exception 'that person is already a member';
  end if;

  -- Only an account that has proved the address counts as that person.
  select u.id into v_user from auth.users u
   where lower(u.email) = v_email and u.email_confirmed_at is not null
   order by u.email_confirmed_at, u.id limit 1;
  if v_user is not null then
    insert into public.members (hive_id, user_id, display_name)
      values (p_hive, v_user, v_name)
      on conflict (hive_id, user_id) do nothing
      returning id into v_member;
    if v_member is null then
      raise exception 'that person is already a member';
    end if;
    insert into public.workspaces (hive_id, member_id, name) values (p_hive, v_member, 'Main');
    -- An invitation made before they had an account has nothing left to do.
    update public.invitations set accepted_at = now(), accepted_member = v_member
     where hive_id = p_hive and email = v_email
       and accepted_at is null and revoked_at is null;
    insert into public.audit_log (hive_id, member_id, action, detail)
      values (p_hive, v_me, 'member.added',
              jsonb_build_object('member', v_member, 'email', v_email));
    return 'added';
  end if;

  -- An invitation that ran out no longer blocks a new one.
  update public.invitations set revoked_at = now()
   where hive_id = p_hive and email = v_email
     and accepted_at is null and revoked_at is null and expires_at <= now();
  insert into public.invitations (hive_id, email, display_name, invited_by)
    values (p_hive, v_email, v_name, v_me)
    on conflict (hive_id, email) where accepted_at is null and revoked_at is null
    do nothing
    returning id into v_invitation;
  if v_invitation is null then
    raise exception 'that email is already invited';
  end if;
  insert into public.audit_log (hive_id, member_id, action, detail)
    values (p_hive, v_me, 'member.invited',
            jsonb_build_object('invitation', v_invitation, 'email', v_email));
  return 'invited';
end
$$;

-- Take back a pending invitation.
create function public.revoke_invitation(p_invitation uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_hive uuid;
  v_email text;
begin
  if public.jwt_agent_id() is not null or public.jwt_is_self_hosted() then
    raise exception 'only the hive owner can invite members';
  end if;
  -- Someone else's invitation is "not found", the same as one that is not there.
  update public.invitations i set revoked_at = now()
   where i.id = p_invitation and i.accepted_at is null and i.revoked_at is null
     and public.is_hive_owner(i.hive_id)
   returning i.hive_id, i.email into v_hive, v_email;
  if v_hive is null then
    raise exception 'invitation not found';
  end if;
  insert into public.audit_log (hive_id, member_id, action, detail)
    values (v_hive,
            (select m.id from public.members m
              where m.hive_id = v_hive and m.user_id = (select auth.uid())),
            'member.invitation_revoked',
            jsonb_build_object('invitation', p_invitation, 'email', v_email));
end
$$;

-- Join every hive that invited the caller's own, confirmed email address.
-- Returns how many hives were joined. Safe to call any number of times: it
-- takes no argument, so there is nothing to choose but one's own invitations,
-- and it never touches a member row that already exists.
create function public.claim_invitations() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text;
  v_member uuid;
  v_joined integer := 0;
  inv record;
begin
  if v_uid is null or public.jwt_agent_id() is not null or public.jwt_is_self_hosted() then
    raise exception 'sign in as a person';
  end if;
  select lower(u.email) into v_email from auth.users u
   where u.id = v_uid and u.email_confirmed_at is not null;
  if v_email is null then
    return 0;
  end if;
  for inv in
    select i.id, i.hive_id, i.display_name from public.invitations i
     where i.email = v_email and i.accepted_at is null and i.revoked_at is null
       and i.expires_at > now()
     order by i.created_at, i.id
     for update
  loop
    insert into public.members (hive_id, user_id, display_name)
      values (inv.hive_id, v_uid, inv.display_name)
      on conflict (hive_id, user_id) do nothing
      returning id into v_member;
    if v_member is not null then
      insert into public.workspaces (hive_id, member_id, name)
        values (inv.hive_id, v_member, 'Main');
      insert into public.audit_log (hive_id, member_id, action, detail)
        values (inv.hive_id, v_member, 'member.joined',
                jsonb_build_object('invitation', inv.id, 'email', v_email));
      v_joined := v_joined + 1;
    else
      -- Already in that hive: the invitation is spent, the member row stays
      -- exactly as it is.
      select m.id into v_member from public.members m
       where m.hive_id = inv.hive_id and m.user_id = v_uid;
    end if;
    update public.invitations set accepted_at = now(), accepted_member = v_member
     where id = inv.id;
  end loop;
  return v_joined;
end
$$;

revoke all on function public.invite_member(uuid, text, text),
  public.revoke_invitation(uuid), public.claim_invitations() from public, anon;
grant execute on function public.invite_member(uuid, text, text),
  public.revoke_invitation(uuid), public.claim_invitations() to authenticated;
