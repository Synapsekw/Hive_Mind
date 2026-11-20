-- Hive Mind: sharing rules.
-- The database decides who can read and write what. The app and the agents
-- cannot override it. An agent signs in with a token and gets the member's
-- identity plus three extra claims: agent_id, workspace_id and trust_tier.

-- ---------------------------------------------------------------- helpers

create function public.my_member_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select id from public.members where user_id = (select auth.uid())
$$;

create function public.my_hive_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select hive_id from public.members where user_id = (select auth.uid())
$$;

create function public.is_hive_owner(p_hive uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.members
    where hive_id = p_hive and user_id = (select auth.uid()) and role = 'owner'
  )
$$;

-- Null for a person signed in to the app, set for an agent.
create function public.jwt_agent_id() returns uuid
language sql stable set search_path = '' as $$
  select nullif(auth.jwt() ->> 'agent_id', '')::uuid
$$;

create function public.jwt_is_self_hosted() returns boolean
language sql stable set search_path = '' as $$
  select coalesce(auth.jwt() ->> 'trust_tier', '') = 'self_hosted'
$$;

-- Note override, else folder rule, else the member's default.
create function public.note_visibility(n public.notes) returns public.visibility
language sql stable security definer set search_path = '' as $$
  select coalesce(
    n.visibility,
    (select f.visibility from public.folders f where f.id = n.folder_id),
    (select m.default_visibility from public.members m where m.id = n.member_id)
  )
$$;

create function public.note_shared_with(n public.notes) returns uuid[]
language sql stable security definer set search_path = '' as $$
  select case
    when n.visibility is not null then n.shared_with
    else coalesce(
      (select f.shared_with from public.folders f
        where f.id = n.folder_id and f.visibility is not null),
      '{}')
  end
$$;

create function public.can_read_note(n public.notes) returns boolean
language sql stable security definer set search_path = '' as $$
  select
    -- Your own notes. A self-hosted agent only sees what it wrote itself.
    (n.member_id in (select public.my_member_ids()) and not public.jwt_is_self_hosted())
    or (public.jwt_agent_id() is not null and n.written_by_agent = public.jwt_agent_id())
    -- Shared notes: never while quarantined, and only inside your hive.
    or (
      not n.quarantined
      and n.hive_id in (select public.my_hive_ids())
      and (
        public.note_visibility(n) = 'group'
        or (public.note_visibility(n) = 'members'
            and public.note_shared_with(n) && array(select public.my_member_ids()))
        -- A link both owners accepted opens the two notes to each other.
        or exists (
          select 1
          from public.links l
          join public.notes o
            on o.id = case when l.from_note = n.id then l.to_note else l.from_note end
          where l.status = 'accepted'
            and n.id in (l.from_note, l.to_note)
            and o.member_id in (select public.my_member_ids())
        )
      )
    )
$$;

-- An agent may only write inside the workspace its token is bound to.
create function public.agent_write_ok(p_workspace uuid) returns boolean
language sql stable set search_path = '' as $$
  select public.jwt_agent_id() is null
      or p_workspace = nullif(auth.jwt() ->> 'workspace_id', '')::uuid
$$;

-- ----------------------------------------------------------------- triggers

create function public.notes_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  w public.workspaces;
  agent uuid := public.jwt_agent_id();
begin
  if tg_op = 'INSERT' then
    select * into w from public.workspaces where id = new.workspace_id;
    if not found or w.member_id <> new.member_id then
      raise exception 'workspace does not belong to this member';
    end if;
    new.hive_id := w.hive_id;
    new.version := 1;
    new.written_by_agent := agent;
    if agent is not null then
      if new.visibility is not null or new.shared_with <> '{}' then
        raise exception 'agents cannot set sharing';
      end if;
      new.quarantined := public.jwt_is_self_hosted();
    end if;
    return new;
  end if;

  if new.member_id <> old.member_id or new.workspace_id <> old.workspace_id
     or new.hive_id <> old.hive_id then
    raise exception 'a note cannot move to another member, workspace or hive';
  end if;
  if agent is not null and (
       new.visibility is distinct from old.visibility
    or new.shared_with <> old.shared_with
    or new.quarantined <> old.quarantined
    or new.folder_id is distinct from old.folder_id) then
    raise exception 'agents cannot change sharing';
  end if;
  if new.title <> old.title or new.body <> old.body or new.frontmatter <> old.frontmatter then
    new.version := old.version + 1;
    new.updated_at := now();
    new.written_by_agent := agent;
  else
    new.version := old.version;
  end if;
  return new;
end
$$;

create function public.notes_after_write() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.version <> old.version then
    insert into public.note_versions (note_id, version, title, body, frontmatter, written_by_agent)
    values (new.id, new.version, new.title, new.body, new.frontmatter, new.written_by_agent);
  end if;
  return null;
end
$$;

create trigger notes_before_write before insert or update on public.notes
  for each row execute function public.notes_before_write();
create trigger notes_after_write after insert or update on public.notes
  for each row execute function public.notes_after_write();

create function public.folders_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if public.jwt_agent_id() is not null and (
       new.visibility is not null or new.shared_with <> '{}') then
    raise exception 'agents cannot set sharing';
  end if;
  if not exists (select 1 from public.workspaces w
                  where w.id = new.workspace_id and w.member_id = new.member_id) then
    raise exception 'workspace does not belong to this member';
  end if;
  return new;
end
$$;

create trigger folders_before_write before insert on public.folders
  for each row execute function public.folders_before_write();

create function public.links_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  a public.notes;
  b public.notes;
begin
  select * into a from public.notes where id = new.from_note;
  select * into b from public.notes where id = new.to_note;
  if a.id is null or b.id is null or a.hive_id <> b.hive_id then
    raise exception 'both notes must exist in the same hive';
  end if;
  new.hive_id := a.hive_id;
  new.status := 'proposed';
  new.to_accepted_at := null;
  -- A person proposing a link has accepted their own side. An agent has not.
  new.from_accepted_at := case
    when public.jwt_agent_id() is null and (select auth.uid()) is not null then now()
  end;
  -- Two notes of the same owner need no handshake.
  if a.member_id = b.member_id then
    new.status := 'accepted';
    new.from_accepted_at := now();
    new.to_accepted_at := now();
  end if;
  return new;
end
$$;

create trigger links_before_insert before insert on public.links
  for each row execute function public.links_before_insert();

-- ---------------------------------------------------------------- policies

alter table public.hives enable row level security;
alter table public.members enable row level security;
alter table public.workspaces enable row level security;
alter table public.agents enable row level security;
alter table public.folders enable row level security;
alter table public.notes enable row level security;
alter table public.note_versions enable row level security;
alter table public.files enable row level security;
alter table public.entities enable row level security;
alter table public.note_entities enable row level security;
alter table public.links enable row level security;
alter table public.synthesis_pages enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_log enable row level security;

create policy hives_select on public.hives for select to authenticated
  using (id in (select public.my_hive_ids()));

create policy members_select on public.members for select to authenticated
  using (hive_id in (select public.my_hive_ids()));
create policy members_update on public.members for update to authenticated
  using (user_id = (select auth.uid()) and public.jwt_agent_id() is null)
  with check (user_id = (select auth.uid()));
-- People may rename themselves and change their default; roles change elsewhere.
revoke update on public.members from authenticated;
grant update (display_name, default_visibility) on public.members to authenticated;

create policy workspaces_select on public.workspaces for select to authenticated
  using (member_id in (select public.my_member_ids()));
create policy workspaces_insert on public.workspaces for insert to authenticated
  with check (member_id in (select public.my_member_ids())
              and hive_id in (select public.my_hive_ids())
              and public.jwt_agent_id() is null);
create policy workspaces_delete on public.workspaces for delete to authenticated
  using (member_id in (select public.my_member_ids()) and public.jwt_agent_id() is null);

-- Agents are created and revoked through functions; the hash is never readable.
create policy agents_select on public.agents for select to authenticated
  using (member_id in (select public.my_member_ids()));
revoke all on public.agents from anon, authenticated;
grant select (id, member_id, workspace_id, name, provider, trust_tier,
              expires_at, revoked_at, last_used_at, created_at)
  on public.agents to authenticated;

create policy folders_select on public.folders for select to authenticated
  using (member_id in (select public.my_member_ids()));
create policy folders_insert on public.folders for insert to authenticated
  with check (member_id in (select public.my_member_ids())
              and public.agent_write_ok(workspace_id));
create policy folders_update on public.folders for update to authenticated
  using (member_id in (select public.my_member_ids()) and public.jwt_agent_id() is null)
  with check (member_id in (select public.my_member_ids()));
create policy folders_delete on public.folders for delete to authenticated
  using (member_id in (select public.my_member_ids()) and public.jwt_agent_id() is null);

create policy notes_select on public.notes for select to authenticated
  using (public.can_read_note(notes));
create policy notes_insert on public.notes for insert to authenticated
  with check (member_id in (select public.my_member_ids())
              and public.agent_write_ok(workspace_id));
create policy notes_update on public.notes for update to authenticated
  using (member_id in (select public.my_member_ids())
         and public.agent_write_ok(workspace_id))
  with check (member_id in (select public.my_member_ids()));
-- Agents never delete.
create policy notes_delete on public.notes for delete to authenticated
  using (member_id in (select public.my_member_ids()) and public.jwt_agent_id() is null);

create policy note_versions_select on public.note_versions for select to authenticated
  using (exists (select 1 from public.notes n where n.id = note_id));

create policy files_select on public.files for select to authenticated
  using ((member_id in (select public.my_member_ids()) and not public.jwt_is_self_hosted())
         or exists (select 1 from public.notes n where n.id = note_id));
create policy files_insert on public.files for insert to authenticated
  with check (member_id in (select public.my_member_ids())
              and hive_id in (select public.my_hive_ids())
              and public.agent_write_ok(workspace_id));
create policy files_delete on public.files for delete to authenticated
  using (member_id in (select public.my_member_ids()) and public.jwt_agent_id() is null);

create policy entities_select on public.entities for select to authenticated
  using (hive_id in (select public.my_hive_ids()));
create policy entities_insert on public.entities for insert to authenticated
  with check (public.is_hive_owner(hive_id) and public.jwt_agent_id() is null);
create policy entities_update on public.entities for update to authenticated
  using (public.is_hive_owner(hive_id) and public.jwt_agent_id() is null)
  with check (public.is_hive_owner(hive_id));
create policy entities_delete on public.entities for delete to authenticated
  using (public.is_hive_owner(hive_id) and public.jwt_agent_id() is null);

create policy note_entities_select on public.note_entities for select to authenticated
  using (exists (select 1 from public.notes n where n.id = note_id));
create policy note_entities_insert on public.note_entities for insert to authenticated
  with check (exists (select 1 from public.notes n
                       where n.id = note_id and n.member_id in (select public.my_member_ids())));
create policy note_entities_delete on public.note_entities for delete to authenticated
  using (exists (select 1 from public.notes n
                  where n.id = note_id and n.member_id in (select public.my_member_ids())));

-- You see a link when one of its notes is yours. Accepting goes through
-- respond_to_link(), so there is no update policy.
create policy links_select on public.links for select to authenticated
  using (exists (select 1 from public.notes n
                  where n.id in (from_note, to_note)
                    and n.member_id in (select public.my_member_ids())));
create policy links_insert on public.links for insert to authenticated
  with check (exists (select 1 from public.notes n
                       where n.id = from_note and n.member_id in (select public.my_member_ids())));

create policy synthesis_select on public.synthesis_pages for select to authenticated
  using (hive_id in (select public.my_hive_ids()));

create policy notifications_select on public.notifications for select to authenticated
  using (member_id in (select public.my_member_ids()) and public.jwt_agent_id() is null);
create policy notifications_update on public.notifications for update to authenticated
  using (member_id in (select public.my_member_ids()) and public.jwt_agent_id() is null)
  with check (member_id in (select public.my_member_ids()));
revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;

create policy audit_select on public.audit_log for select to authenticated
  using (public.is_hive_owner(hive_id) and public.jwt_agent_id() is null);

-- --------------------------------------------------------------- functions

-- Start a hive. The caller becomes its owner and gets a first workspace.
create function public.create_hive(p_name text, p_display_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_hive uuid;
  v_member uuid;
begin
  if (select auth.uid()) is null or public.jwt_agent_id() is not null then
    raise exception 'sign in as a person to create a hive';
  end if;
  insert into public.hives (name) values (p_name) returning id into v_hive;
  insert into public.members (hive_id, user_id, display_name, role)
    values (v_hive, (select auth.uid()), p_display_name, 'owner') returning id into v_member;
  insert into public.workspaces (hive_id, member_id, name) values (v_hive, v_member, 'Main');
  return v_hive;
end
$$;

-- Owner adds an existing user to the hive by email.
create function public.add_member(p_hive uuid, p_email text, p_display_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid;
  v_member uuid;
begin
  if not public.is_hive_owner(p_hive) or public.jwt_agent_id() is not null then
    raise exception 'only the hive owner can add members';
  end if;
  select id into v_user from auth.users where lower(email) = lower(p_email);
  if v_user is null then
    raise exception 'no user with that email has signed up yet';
  end if;
  insert into public.members (hive_id, user_id, display_name)
    values (p_hive, v_user, p_display_name) returning id into v_member;
  insert into public.workspaces (hive_id, member_id, name) values (p_hive, v_member, 'Main');
  return v_member;
end
$$;

-- Connect an agent to one workspace. Returns the token once.
create function public.create_agent(
  p_workspace uuid, p_name text, p_provider text,
  p_trust_tier public.trust_tier default 'vendor')
returns table (agent_id uuid, token text)
language plpgsql security definer set search_path = '' as $$
declare
  v_member uuid;
  v_token text := 'hive_' || replace(gen_random_uuid()::text, '-', '')
                          || replace(gen_random_uuid()::text, '-', '');
  v_agent uuid;
begin
  if public.jwt_agent_id() is not null then
    raise exception 'agents cannot create agents';
  end if;
  select w.member_id into v_member from public.workspaces w
   where w.id = p_workspace and w.member_id in (select public.my_member_ids());
  if v_member is null then
    raise exception 'that workspace is not yours';
  end if;
  insert into public.agents (member_id, workspace_id, name, provider, trust_tier, token_hash)
    values (v_member, p_workspace, p_name, p_provider, p_trust_tier,
            encode(sha256(convert_to(v_token, 'UTF8')), 'hex'))
    returning id into v_agent;
  return query select v_agent, v_token;
end
$$;

create function public.revoke_agent(p_agent uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if public.jwt_agent_id() is not null then
    raise exception 'agents cannot revoke agents';
  end if;
  update public.agents set revoked_at = now()
   where id = p_agent and member_id in (select public.my_member_ids());
  if not found then
    raise exception 'that agent is not yours';
  end if;
end
$$;

-- The agent server exchanges a token for the identity it should act as.
create function public.agent_login(p_token text)
returns table (agent_id uuid, user_id uuid, member_id uuid, workspace_id uuid,
               hive_id uuid, trust_tier public.trust_tier)
language plpgsql security definer set search_path = '' as $$
declare
  v_agent uuid;
begin
  select a.id into v_agent from public.agents a
   where a.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
     and a.revoked_at is null
     and (a.expires_at is null or a.expires_at > now());
  if v_agent is null then
    raise exception 'unknown, expired or revoked token';
  end if;
  update public.agents set last_used_at = now() where id = v_agent;
  return query
    select a.id, m.user_id, m.id, a.workspace_id, m.hive_id, a.trust_tier
      from public.agents a join public.members m on m.id = a.member_id
     where a.id = v_agent;
end
$$;

-- Accept or decline your side of a link. People only.
create function public.respond_to_link(p_link uuid, p_accept boolean) returns public.link_status
language plpgsql security definer set search_path = '' as $$
declare
  l public.links;
  mine_from boolean;
  mine_to boolean;
begin
  if (select auth.uid()) is null or public.jwt_agent_id() is not null then
    raise exception 'only a person can accept or decline a link';
  end if;
  select * into l from public.links where id = p_link for update;
  if l.id is null then
    raise exception 'link not found';
  end if;
  select n.member_id in (select public.my_member_ids()) into mine_from
    from public.notes n where n.id = l.from_note;
  select n.member_id in (select public.my_member_ids()) into mine_to
    from public.notes n where n.id = l.to_note;
  if not (mine_from or mine_to) then
    raise exception 'link not found';
  end if;
  if not p_accept then
    update public.links set status = 'declined' where id = p_link;
    return 'declined';
  end if;
  if l.status = 'declined' then
    raise exception 'this link was declined';
  end if;
  update public.links set
      from_accepted_at = case when mine_from then coalesce(from_accepted_at, now()) else from_accepted_at end,
      to_accepted_at = case when mine_to then coalesce(to_accepted_at, now()) else to_accepted_at end
    where id = p_link
    returning * into l;
  if l.from_accepted_at is not null and l.to_accepted_at is not null then
    update public.links set status = 'accepted' where id = p_link;
    return 'accepted';
  end if;
  return 'proposed';
end
$$;

-- Keyword search over everything the caller may read.
create function public.search_notes(p_query text, p_limit integer default 20)
returns table (id uuid, path text, title text, member_id uuid, updated_at timestamptz, rank real)
language sql stable set search_path = '' as $$
  select n.id, n.path, n.title, n.member_id, n.updated_at,
         ts_rank(n.search, websearch_to_tsquery('simple', p_query)) as rank
    from public.notes n
   where n.search @@ websearch_to_tsquery('simple', p_query)
   order by rank desc, n.updated_at desc
   limit least(greatest(p_limit, 1), 50)
$$;

revoke execute on function
  public.create_hive(text, text),
  public.add_member(uuid, text, text),
  public.create_agent(uuid, text, text, public.trust_tier),
  public.revoke_agent(uuid),
  public.respond_to_link(uuid, boolean),
  public.search_notes(text, integer)
from public, anon;
grant execute on function
  public.create_hive(text, text),
  public.add_member(uuid, text, text),
  public.create_agent(uuid, text, text, public.trust_tier),
  public.revoke_agent(uuid),
  public.respond_to_link(uuid, boolean),
  public.search_notes(text, integer)
to authenticated;
