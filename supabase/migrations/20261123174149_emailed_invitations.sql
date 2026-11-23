-- 20261123174149_emailed_invitations.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp). Do not hand-edit
-- the version, and never edit a migration that has shipped.
--
-- What this migration does:
--   Nobody becomes a member of a hive without pressing Join. The owner invites
--   an address, the server emails the invitation, and the invited person
--   accepts it after signing in with that address.
--
--   - invitations gains last_emailed_at and email_count: when and how often
--     the invitation was emailed.
--   - invite_member returns the invitation's id and never adds a member,
--     whether or not the address has an account. A hive makes at most 20
--     invitations in 24 hours, and so does a person over all their hives.
--   - invitation_to_email: the one thing the mail function asks the database.
--     For the hive's owner and an open invitation it counts one more email
--     and returns the address. At most one email in 2 minutes and 5 for one
--     invitation. Each one is in the audit log as member.invitation_emailed.
--   - my_invitations: the open invitations for the caller's own confirmed
--     email address.
--   - accept_invitation: the caller joins the hive of one invitation that is
--     for their own confirmed email address.
--   - claim_invitations is dropped: nothing joins silently any more.
--   - add_member is no longer executable through the API: it added any
--     account to a hive without asking that person.
--
--   - One address gets at most 5 invitation emails in 24 hours from one
--     person, however often it is revoked and invited again.
--
--   It also fixes a fault in three functions of earlier migrations. Their
--   list of white space to trim was written E' \t\n\r\f\v'. Postgres has no
--   \v escape: that is the letter "v", so "v" was trimmed from both ends.
--   The list is now space, tab, newline, carriage return, form feed and the
--   vertical tab (\x0B). The bodies are otherwise unchanged.
--   - invite_member stored alice@company.dev as alice@company.de, and a name
--     lost a leading or trailing "v". Rows already stored are not changed.
--   - oauth_client_tier read a redirect list such as vhttps://claude.ai/x as
--     https://claude.ai/x and rated the app 'vendor'. It is 'self_hosted'.
--     The tier is worked out again at every connector_login, so no stored
--     value has to be corrected for sharing to be right.
--   - connect_app trimmed "v" from the ends of an app's name.
--
--   Nobody joins a hive unless auth.users.email_confirmed_at is set for them
--   and their email equals the invitation's after lower-casing. Agents,
--   self-hosted identities and app passes are refused by every function here.
--   revoke_invitation stays as it is.

alter table public.invitations
  add column last_emailed_at timestamptz,
  add column email_count integer not null default 0 check (email_count >= 0);

-- Invite a person into a hive. Returns the invitation's id. The answer is the
-- same whether or not the address has an account: the owner is never told.
drop function public.invite_member(uuid, text, text);
create function public.invite_member(p_hive uuid, p_email text, p_display_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_space constant text := E' \t\n\r\f\x0B';
  v_email text := lower(btrim(coalesce(p_email, ''), v_space));
  v_name text := btrim(coalesce(p_display_name, ''), v_space);
  v_uid uuid := (select auth.uid());
  v_me uuid;
  v_invitation uuid;
begin
  if public.jwt_oauth_client() is not null then
    raise exception 'an app pass cannot do this';
  end if;
  if public.jwt_agent_id() is not null or public.jwt_is_self_hosted()
     or not public.is_hive_owner(p_hive) then
    raise exception 'only the hive owner can invite members';
  end if;
  if length(v_email) > 254
     or v_email !~ '^[^@[:space:][:cntrl:]]+@[^@[:space:][:cntrl:]]+$' then
    raise exception 'enter a valid email address';
  end if;
  if length(v_name) not between 1 and 60 or v_name ~ '[[:cntrl:]]' then
    raise exception 'enter a name of 1 to 60 characters';
  end if;

  -- One invitation of a person at a time, then one of a hive at a time, so
  -- calls arriving together cannot each count 19 and all pass a daily limit.
  -- Always in this order: the person first, then the hive.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('invite_member:' || v_uid::text, 0));
  perform 1 from public.hives h where h.id = p_hive for no key update;

  select m.id into v_me from public.members m
   where m.hive_id = p_hive and m.user_id = (select auth.uid());

  -- The owner reads the member list already, so this tells them nothing new.
  if exists (select 1 from public.members m join auth.users u on u.id = m.user_id
              where m.hive_id = p_hive and lower(u.email) = v_email) then
    raise exception 'that person is already a member';
  end if;

  -- An invitation that ran out no longer blocks a new one.
  update public.invitations set revoked_at = now()
   where hive_id = p_hive and email = v_email
     and accepted_at is null and revoked_at is null and expires_at <= now();
  if exists (select 1 from public.invitations i
              where i.hive_id = p_hive and i.email = v_email
                and i.accepted_at is null and i.revoked_at is null) then
    raise exception 'that email is already invited';
  end if;

  -- Every invitation made counts, revoked and accepted ones too: revoking
  -- does not buy another email.
  if (select count(*) from public.invitations i
       where i.hive_id = p_hive and i.created_at > now() - interval '24 hours') >= 20 then
    raise exception 'too many invitations today';
  end if;
  -- The same for the person, over every hive they invite into: starting
  -- another hive does not buy another twenty.
  if (select count(*) from public.invitations i
        join public.members m on m.id = i.invited_by
       where m.user_id = v_uid and i.created_at > now() - interval '24 hours') >= 20 then
    raise exception 'too many invitations today';
  end if;

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
  return v_invitation;
end
$$;

-- The address an invitation is to be emailed to, counted as one more email.
-- Called by the mail function with the owner's own session, so the database
-- decides who may cause an email and how often.
create function public.invitation_to_email(p_invitation uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  inv record;
begin
  if public.jwt_oauth_client() is not null then
    raise exception 'an app pass cannot do this';
  end if;
  if public.jwt_agent_id() is not null or public.jwt_is_self_hosted() then
    raise exception 'only the hive owner can invite members';
  end if;
  -- One call of a person at a time (the same lock as invite_member, taken
  -- first there too), then the invitation's row: both are held before the
  -- limits are read, so two calls at once cannot both pass.
  if v_uid is not null then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('invite_member:' || v_uid::text, 0));
  end if;
  -- Someone else's invitation is "not found", the same as one that is not
  -- there, was revoked, was accepted or ran out.
  select i.hive_id, i.email, i.last_emailed_at, i.email_count into inv
    from public.invitations i
   where i.id = p_invitation and i.accepted_at is null and i.revoked_at is null
     and i.expires_at > now()
     and public.is_hive_owner(i.hive_id)
     for update;
  if not found then
    raise exception 'invitation not found';
  end if;
  if inv.email_count >= 5 then
    raise exception 'too many emails for this invitation';
  end if;
  if inv.last_emailed_at is not null
     and inv.last_emailed_at > now() - interval '2 minutes' then
    raise exception 'wait before sending again';
  end if;
  -- The address, not only the invitation: revoking and inviting again, or
  -- inviting from another hive of the same person, does not buy more emails.
  if (select count(*) from public.audit_log a
        join public.members m on m.id = a.member_id and m.hive_id = a.hive_id
       where m.user_id = v_uid
         and a.action = 'member.invitation_emailed'
         and a.detail ->> 'email' = inv.email
         and a.at > now() - interval '24 hours') >= 5 then
    raise exception 'too many emails for this invitation';
  end if;
  update public.invitations
     set last_emailed_at = now(), email_count = email_count + 1
   where id = p_invitation;
  insert into public.audit_log (hive_id, member_id, action, detail)
    values (inv.hive_id,
            (select m.id from public.members m
              where m.hive_id = inv.hive_id and m.user_id = (select auth.uid())),
            'member.invitation_emailed',
            jsonb_build_object('invitation', p_invitation, 'email', inv.email));
  return inv.email;
end
$$;

-- The invitations waiting for the caller: open, not run out, and made for the
-- email address the caller has proved is theirs. An account that never
-- confirmed its address gets none.
create function public.my_invitations()
returns table (id uuid, hive_name text, invited_by text, expires_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text;
begin
  if public.jwt_oauth_client() is not null then
    raise exception 'an app pass cannot do this';
  end if;
  if v_uid is null or public.jwt_agent_id() is not null or public.jwt_is_self_hosted() then
    raise exception 'sign in as a person';
  end if;
  select lower(u.email) into v_email from auth.users u
   where u.id = v_uid and u.email_confirmed_at is not null;
  if v_email is null then
    return;
  end if;
  return query
    select i.id, h.name::text, coalesce(m.display_name, '')::text, i.expires_at
      from public.invitations i
      join public.hives h on h.id = i.hive_id
      left join public.members m on m.id = i.invited_by
     where i.email = v_email and i.accepted_at is null and i.revoked_at is null
       and i.expires_at > now()
     order by i.created_at, i.id
     limit 50;
end
$$;

-- Join the hive of one invitation. The invitation must be open, not run out,
-- and made for the caller's own confirmed email address; anything else is
-- "invitation not found". Returns the hive. It never touches a member row
-- that already exists.
create function public.accept_invitation(p_invitation uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text;
  v_member uuid;
  inv record;
begin
  if public.jwt_oauth_client() is not null then
    raise exception 'an app pass cannot do this';
  end if;
  if v_uid is null or public.jwt_agent_id() is not null or public.jwt_is_self_hosted() then
    raise exception 'sign in as a person';
  end if;
  -- Only an account that has proved the address counts as that person.
  select lower(u.email) into v_email from auth.users u
   where u.id = v_uid and u.email_confirmed_at is not null;
  if v_email is null then
    raise exception 'invitation not found';
  end if;
  select i.id, i.hive_id, i.display_name into inv from public.invitations i
   where i.id = p_invitation and i.email = v_email
     and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
     for update;
  if not found then
    raise exception 'invitation not found';
  end if;

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
  else
    -- Already in that hive: the invitation is spent, the member row stays
    -- exactly as it is.
    select m.id into v_member from public.members m
     where m.hive_id = inv.hive_id and m.user_id = v_uid;
  end if;
  update public.invitations set accepted_at = now(), accepted_member = v_member
   where id = inv.id;
  return inv.hive_id;
end
$$;

-- ------------------------------------------- the white space that is trimmed

-- As in 20261123150712_connected_apps.sql, with the list of white space
-- corrected (see the top of this file). Nothing else differs.

create or replace function public.oauth_client_tier(p_client uuid) returns public.trust_tier
language plpgsql stable security definer set search_path = '' as $$
declare
  v_trusted constant text[] := array['claude.ai', 'claude.com', 'chatgpt.com', 'openai.com'];
  v_space constant text := E' \t\n\r\f\x0B';
  v_raw text;
  v_uris text[];
  v_uri text;
  v_host text;
begin
  select btrim(c.redirect_uris, v_space) into v_raw
    from auth.oauth_clients c
   where c.id = p_client and c.deleted_at is null;
  if v_raw is null or v_raw = '' then
    return 'self_hosted';
  end if;

  if left(v_raw, 1) = '[' then
    begin
      -- A member that is not a string becomes null, and fails below.
      select array_agg(case when jsonb_typeof(e) = 'string' then e #>> '{}' end)
        into v_uris
        from jsonb_array_elements(v_raw::jsonb) e;
    exception when others then
      return 'self_hosted';
    end;
  else
    select array_agg(u) into v_uris
      from regexp_split_to_table(v_raw, '[,[:space:]]+') u
     where u <> '';
  end if;
  if v_uris is null or cardinality(v_uris) = 0 then
    return 'self_hosted';
  end if;

  foreach v_uri in array v_uris loop
    if v_uri is null or v_uri ~ '[[:space:][:cntrl:]]' then
      return 'self_hosted';
    end if;
    -- https, then a bare host name, then an optional port, then the end or the
    -- start of a path, query or fragment. An '@', a backslash or a percent
    -- sign after the host does not match, so user info never passes.
    v_host := substring(lower(v_uri) from
      '^https://([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)(?::[0-9]{1,5})?(?:[/?#].*)?$');
    if v_host is null
       or not exists (select 1 from unnest(v_trusted) d
                       where v_host = d or right(v_host, length(d) + 1) = '.' || d) then
      return 'self_hosted';
    end if;
  end loop;
  return 'vendor';
end
$$;

create or replace function public.connect_app(p_client_id text, p_workspace uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_space constant text := E' \t\n\r\f\x0B';
  v_uid uuid := (select auth.uid());
  v_client uuid;
  v_found boolean;
  v_name text;
  v_member uuid;
  v_hive uuid;
  v_tier public.trust_tier;
  v_agent uuid;
begin
  if public.jwt_oauth_client() is not null then
    raise exception 'an app pass cannot do this';
  end if;
  if v_uid is null or public.jwt_agent_id() is not null or public.jwt_is_self_hosted() then
    raise exception 'only a person can connect an app';
  end if;
  select m.id, m.hive_id into v_member, v_hive
    from public.workspaces w join public.members m on m.id = w.member_id
   where w.id = p_workspace and m.user_id = v_uid;
  if v_member is null then
    raise exception 'that workspace is not yours';
  end if;

  -- The app must be one the sign-in server knows. The id is checked to be a
  -- uuid before it is cast, so nothing else reaches the cast.
  if coalesce(p_client_id, '') ~*
     '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_client := p_client_id::uuid;
    select true, c.client_name into v_found, v_name
      from auth.oauth_clients c
     where c.id = v_client and c.deleted_at is null;
  end if;
  if v_found is not true then
    raise exception 'unknown app';
  end if;

  -- The name the app registered is the app's own choice of words, shown to
  -- the person later. Control characters and line separators become a space;
  -- the characters that reorder or hide text (bidi marks, zero-width and
  -- other format characters, tags) are dropped.
  v_name := regexp_replace(coalesce(v_name, ''),
    '[\u0001-\u001F\u007F-\u009F  ]', ' ', 'g');
  v_name := regexp_replace(v_name,
    '[­؜᠎​-‏‪-‮⁠-⁯﻿￹-￻\U000E0000-\U000E007F]',
    '', 'g');
  v_name := regexp_replace(v_name, '[[:space:]]+', ' ', 'g');
  v_name := btrim(left(btrim(v_name, v_space), 120), v_space);
  if v_name = '' then
    v_name := 'Connected app';
  end if;

  -- Kept for Settings to show. connector_login works it out again each time.
  v_tier := public.oauth_client_tier(v_client);

  -- A pass names the person and the app, not a hive: the person has one live
  -- agent per app, the one approved last.
  update public.agents a set revoked_at = now()
    from public.members m
   where m.id = a.member_id and m.user_id = v_uid
     and a.oauth_client_id = v_client::text
     and a.member_id <> v_member
     and a.revoked_at is null;

  insert into public.agents (member_id, workspace_id, name, provider, trust_tier, oauth_client_id)
    values (v_member, p_workspace, v_name, 'Connected app', v_tier, v_client::text)
    on conflict (member_id, oauth_client_id) where oauth_client_id is not null
    do update set workspace_id = excluded.workspace_id,
                  name = excluded.name,
                  trust_tier = excluded.trust_tier,
                  revoked_at = null,
                  expires_at = null
    returning id into v_agent;

  insert into public.audit_log (hive_id, member_id, action, detail)
    values (v_hive, v_member, 'agent.connected',
            jsonb_build_object('agent', v_agent, 'client_id', v_client::text,
                               'workspace', p_workspace, 'trust_tier', v_tier));
  return v_agent;
end
$$;

-- create or replace keeps the rights of both; said again so that they are
-- what this file leaves behind whatever came before. oauth_client_tier is the
-- database's own: nobody calls it through the API.
revoke all on function public.oauth_client_tier(uuid)
from public, anon, authenticated, service_role;
revoke all on function public.connect_app(text, uuid) from public, anon;
grant execute on function public.connect_app(text, uuid) to authenticated;

-- Nothing joins silently any more.
drop function public.claim_invitations();

-- add_member put any account into a hive without asking that person. Its
-- execute right was never taken from public, so taking it from authenticated
-- alone would change nothing: it goes from all three.
revoke all on function public.add_member(uuid, text, text)
from public, anon, authenticated;

revoke all on function
  public.invite_member(uuid, text, text),
  public.invitation_to_email(uuid),
  public.my_invitations(),
  public.accept_invitation(uuid)
from public, anon;
grant execute on function
  public.invite_member(uuid, text, text),
  public.invitation_to_email(uuid),
  public.my_invitations(),
  public.accept_invitation(uuid)
to authenticated;
