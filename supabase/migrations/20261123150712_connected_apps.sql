-- 20261123150712_connected_apps.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp). Do not hand-edit
-- the version, and never edit a migration that has shipped.
--
-- What this migration does:
--   Connected apps. A person adds the hive to Claude or ChatGPT by signing in
--   and approving in a window; no token is pasted. Supabase's OAuth server
--   then gives the app an access token that is the person's own identity plus
--   a client_id claim. Here that is called an app pass.
--
--   An app pass says "I am this person", so without the rules below the app
--   could do everything the person can, including changing sharing. So:
--
--   - The database refuses an app pass everywhere. Every table in public and
--     storage.objects gets a restrictive policy <table>_no_app that fails when
--     the caller carries a client_id. Every function authenticated may execute
--     refuses such a caller: the ones row-level security calls answer nothing
--     (no rows, false), the others raise 'an app pass cannot do this'.
--     Security definer functions bypass row-level security, which is why each
--     one is guarded by itself. The bodies are otherwise unchanged from their
--     latest definitions.
--   - The one exception is connector_login(): it swaps the pass for the row of
--     the agent the person approved, and the connector signs the usual limited
--     agent identity from it. agent_login(token) is unchanged: it answers by
--     the token alone, for anyone.
--   - agents.oauth_client_id: the app's client id, null for an agent with a
--     token. agents.token_hash becomes nullable; an agent has exactly one of
--     the two. One agent per member and client.
--   - jwt_oauth_client(): the caller's client_id claim, or null.
--   - connect_app(client, name, redirect host, workspace): a person, in the
--     approval window, connects an app to one of their own workspaces, or
--     reconnects it (same member and client: the workspace and name are
--     updated, a revoke is lifted). The trust tier is 'vendor' only when the
--     redirect host is one of a fixed list or a subdomain of one; any other
--     app is 'self_hosted', so what it writes is held for the person's review.
--     An app once seen as self_hosted stays so. A person has at most one live
--     agent per app: approving it for a workspace in another hive revokes the
--     earlier one. Writes 'agent.connected' to the audit log.
--   - revoke_agent works as before; a revoked app fails connector_login.
--
--   Nothing here widens who can read or write what.

-- ------------------------------------------------------------------ agents

alter table public.agents add column oauth_client_id text;
alter table public.agents alter column token_hash drop not null;
alter table public.agents add constraint agents_one_credential
  check (num_nonnulls(token_hash, oauth_client_id) = 1);
-- Also what connector_login reads by. The column is not granted to
-- authenticated: like the token hash, nobody reads it through the API.
create unique index agents_member_client_idx
  on public.agents (member_id, oauth_client_id)
  where oauth_client_id is not null;

-- Null for a person signed in to the app and for an agent; set for an app
-- that holds a pass from the OAuth server.
create function public.jwt_oauth_client() returns text
language sql stable set search_path = '' as $$
  select nullif(auth.jwt() ->> 'client_id', '')
$$;

-- ---------------------------------------------------------------- policies

-- Restrictive: combined with AND, so no other policy can let a pass through.
create policy hives_no_app on public.hives as restrictive for all to authenticated
  using (public.jwt_oauth_client() is null)
  with check (public.jwt_oauth_client() is null);
create policy members_no_app on public.members as restrictive for all to authenticated
  using (public.jwt_oauth_client() is null)
  with check (public.jwt_oauth_client() is null);
create policy workspaces_no_app on public.workspaces as restrictive for all to authenticated
  using (public.jwt_oauth_client() is null)
  with check (public.jwt_oauth_client() is null);
create policy agents_no_app on public.agents as restrictive for all to authenticated
  using (public.jwt_oauth_client() is null)
  with check (public.jwt_oauth_client() is null);
create policy folders_no_app on public.folders as restrictive for all to authenticated
  using (public.jwt_oauth_client() is null)
  with check (public.jwt_oauth_client() is null);
create policy notes_no_app on public.notes as restrictive for all to authenticated
  using (public.jwt_oauth_client() is null)
  with check (public.jwt_oauth_client() is null);
create policy note_versions_no_app on public.note_versions as restrictive for all to authenticated
  using (public.jwt_oauth_client() is null)
  with check (public.jwt_oauth_client() is null);
create policy files_no_app on public.files as restrictive for all to authenticated
  using (public.jwt_oauth_client() is null)
  with check (public.jwt_oauth_client() is null);
create policy entities_no_app on public.entities as restrictive for all to authenticated
  using (public.jwt_oauth_client() is null)
  with check (public.jwt_oauth_client() is null);
create policy note_entities_no_app on public.note_entities as restrictive for all to authenticated
  using (public.jwt_oauth_client() is null)
  with check (public.jwt_oauth_client() is null);
create policy links_no_app on public.links as restrictive for all to authenticated
  using (public.jwt_oauth_client() is null)
  with check (public.jwt_oauth_client() is null);
create policy synthesis_pages_no_app on public.synthesis_pages as restrictive for all to authenticated
  using (public.jwt_oauth_client() is null)
  with check (public.jwt_oauth_client() is null);
create policy notifications_no_app on public.notifications as restrictive for all to authenticated
  using (public.jwt_oauth_client() is null)
  with check (public.jwt_oauth_client() is null);
create policy audit_log_no_app on public.audit_log as restrictive for all to authenticated
  using (public.jwt_oauth_client() is null)
  with check (public.jwt_oauth_client() is null);
create policy invitations_no_app on public.invitations as restrictive for all to authenticated
  using (public.jwt_oauth_client() is null)
  with check (public.jwt_oauth_client() is null);
create policy objects_no_app on storage.objects as restrictive for all to authenticated
  using (public.jwt_oauth_client() is null)
  with check (public.jwt_oauth_client() is null);

-- ----------------------------------------- helpers row-level security calls

-- These answer nothing for an app pass instead of raising, so a query by a
-- pass returns no rows. owns_file_path, can_write_file and can_read_file rest
-- on my_member_ids and on row-level security, and need no change.

create or replace function public.my_member_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select id from public.members
   where user_id = (select auth.uid()) and public.jwt_oauth_client() is null
$$;

create or replace function public.my_hive_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select hive_id from public.members
   where user_id = (select auth.uid()) and public.jwt_oauth_client() is null
$$;

create or replace function public.is_hive_owner(p_hive uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.jwt_oauth_client() is null and exists (
    select 1 from public.members
    where hive_id = p_hive and user_id = (select auth.uid()) and role = 'owner'
  )
$$;

create or replace function public.agent_write_ok(p_workspace uuid) returns boolean
language sql stable set search_path = '' as $$
  select public.jwt_oauth_client() is null
     and (public.jwt_agent_id() is null
          or p_workspace = nullif(auth.jwt() ->> 'workspace_id', '')::uuid)
$$;

create or replace function public.can_read_note(n public.notes) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  x public.notes;
begin
  if public.jwt_oauth_client() is not null then
    return false;
  end if;
  if public._is_mine(n) then
    return public._can_read_note(n);
  end if;
  select * into x from public.notes s where s.id = n.id;
  if x.id is null then
    return false;
  end if;
  return public._can_read_note(x);
end
$$;

create or replace function public.note_rule_folder(n public.notes) returns text
language sql stable security definer set search_path = '' as $$
  select (select r.path from public.note_folder_rule(x) r)
    from public.notes x
   where x.id = n.id
     and public.jwt_oauth_client() is null
     and public._can_read_note(x)
$$;

create or replace function public.note_access(n public.notes) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when x.member_id in (select public.my_member_ids()) then 'own'
    when public._note_visibility(x) = 'group'
      or (public._note_visibility(x) = 'members'
          and public._note_shared_with(x) && array(select public.my_member_ids()))
      then 'shared'
    else 'link'
  end
    from public.notes x
   where x.id = n.id
     and public.jwt_oauth_client() is null
     and public._can_read_note(x)
$$;

create or replace function public.search_notes(p_query text, p_limit integer default 20)
returns table (id uuid, path text, title text, member_id uuid, updated_at timestamptz, rank real)
language sql stable set search_path = '' as $$
  select n.id, n.path, n.title, n.member_id, n.updated_at,
         ts_rank(n.search, websearch_to_tsquery('simple', p_query)) as rank
    from public.notes n
   where n.search @@ websearch_to_tsquery('simple', p_query)
     and public.jwt_oauth_client() is null
   order by rank desc, n.updated_at desc
   limit least(greatest(p_limit, 1), 50)
$$;

-- ------------------------------------------------ functions people call

-- Each as in its latest definition, with the refusal first.

create or replace function public.note_visibility(n public.notes)
returns public.visibility
language plpgsql stable security definer set search_path = '' as $$
declare
  x public.notes;
begin
  if public.jwt_oauth_client() is not null then
    raise exception 'an app pass cannot do this';
  end if;
  if public._is_mine(n) then
    return public._note_visibility(n);
  end if;
  select * into x from public.notes s where s.id = n.id;
  if x.id is null or not public._can_read_note(x) then
    return null;
  end if;
  return public._note_visibility(x);
end
$$;

create or replace function public.note_shared_with(n public.notes) returns uuid[]
language plpgsql stable security definer set search_path = '' as $$
declare
  x public.notes;
begin
  if public.jwt_oauth_client() is not null then
    raise exception 'an app pass cannot do this';
  end if;
  if public._is_mine(n) then
    return public._note_shared_with(n);
  end if;
  select * into x from public.notes s where s.id = n.id;
  if x.id is null or not public._can_read_note(x) then
    return null;
  end if;
  return public._note_shared_with(x);
end
$$;

create or replace function public.folder_share_preview(p_workspace uuid, p_path text)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_owner uuid;
  v_result jsonb;
begin
  if public.jwt_oauth_client() is not null then
    raise exception 'an app pass cannot do this';
  end if;
  if public.jwt_agent_id() is not null or public.jwt_is_self_hosted() then
    raise exception 'for people only';
  end if;
  select w.member_id into v_owner from public.workspaces w
   where w.id = p_workspace
     and w.member_id in (select public.my_member_ids());
  if v_owner is null then
    raise exception 'not your workspace';
  end if;

  with nested as (
    select f.path
      from public.folders f
     where f.workspace_id = p_workspace
       and f.member_id = v_owner
       and f.visibility is not null
       and left(f.path, length(p_path) + 1) = p_path || '/'
  ),
  under as (
    select n.visibility is not null as own,
           n.quarantined,
           exists (select 1 from nested f
                    where left(n.path, length(f.path) + 1) = f.path || '/') as deeper
      from public.notes n
     where n.workspace_id = p_workspace
       and left(n.path, length(p_path) + 1) = p_path || '/'
  )
  select jsonb_build_object(
           'follows', count(*) filter (where not own and not deeper),
           'own_setting', count(*) filter (where own),
           'under_nested_rule', count(*) filter (where not own and deeper),
           'held', count(*) filter (where not own and not deeper and quarantined))
    into v_result
    from under;
  return v_result;
end
$$;

create or replace function public.map_graph(p_hive uuid) returns jsonb
language plpgsql stable security definer
set search_path = ''
set plan_cache_mode = force_custom_plan
as $$
declare
  v_cap constant integer := 5000;
  v_me uuid;
  v_total bigint;
  v_nodes jsonb;
  v_open uuid[];
  v_members jsonb;
  v_agents jsonb;
  v_links jsonb;
begin
  if public.jwt_oauth_client() is not null then
    raise exception 'an app pass cannot do this';
  end if;
  -- People only. A self-hosted claim without an agent id is refused as well.
  if public.jwt_agent_id() is not null or public.jwt_is_self_hosted() then
    raise exception 'map_graph is for people';
  end if;
  select m.id into v_me from public.members m
   where m.hive_id = p_hive and m.user_id = (select auth.uid());
  if v_me is null then
    raise exception 'not a member of this hive';
  end if;

  with items as (
    select n.id, 'note'::text as kind, n.updated_at, null::uuid as file_note
      from public.notes n
     where n.hive_id = p_hive
       and (n.member_id = v_me or not n.quarantined)
    union all
    select f.id, 'file'::text, f.created_at, fn.id
      from public.files f
      left join public.notes fn on fn.id = f.note_id and fn.hive_id = p_hive
     where f.hive_id = p_hive
       and (f.member_id = v_me or fn.id is null or not fn.quarantined)
  ),
  picked as (
    select i.*, count(*) over () as total
      from items i
     order by i.updated_at desc, i.id
     limit v_cap
  ),
  kept as materialized (
    select p.id, p.kind, p.updated_at, p.total,
           public.note_topic(n.path) as topic,
           n.member_id,
           public._can_read_note(n) as readable,
           n.title, n.path, n.workspace_id,
           (n.written_by_agent is not null) as by_agent,
           case when n.member_id = v_me then n.written_by_agent end as agent_id,
           null::uuid as note_id
      from picked p
      join public.notes n on n.id = p.id and n.hive_id = p_hive
     where p.kind = 'note'
    union all
    select p.id, p.kind, p.updated_at, p.total,
           case when fn.id is null then 'Files' else public.note_topic(fn.path) end,
           f.member_id,
           (f.member_id = v_me or (fn.id is not null and public._can_read_note(fn))),
           f.name, f.storage_path, f.workspace_id,
           false,
           null::uuid,
           f.note_id
      from picked p
      join public.files f on f.id = p.id and f.hive_id = p_hive
      left join public.notes fn on fn.id = p.file_note and fn.hive_id = p_hive
     where p.kind = 'file'
  )
  select coalesce(max(k.total), 0),
         coalesce(jsonb_agg(jsonb_build_object(
           'id', k.id,
           'kind', k.kind,
           'topic', k.topic,
           'member_id', k.member_id,
           'updated_at', k.updated_at,
           'locked', not k.readable,
           'title', case when k.readable then k.title end,
           'path', case when k.readable then k.path end,
           'workspace_id', case when k.readable then k.workspace_id end,
           'by_agent', case when k.readable then k.by_agent end,
           'agent_id', case when k.readable then k.agent_id end,
           'note_id', case when k.readable then k.note_id end
         ) order by k.updated_at desc, k.id), '[]'::jsonb),
         coalesce(array_agg(k.id) filter (where k.readable and k.kind = 'note'), '{}')
    into v_total, v_nodes, v_open
    from kept k;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', m.id,
           'display_name', m.display_name,
           'is_me', m.id = v_me
         ) order by m.created_at, m.id), '[]'::jsonb)
    into v_members
    from public.members m
   where m.hive_id = p_hive;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', a.id,
           'member_id', a.member_id,
           'provider', a.provider,
           'trust_tier', a.trust_tier,
           'last_used_at', a.last_used_at,
           'name', case when a.member_id = v_me then a.name end
         ) order by a.created_at, a.id), '[]'::jsonb)
    into v_agents
    from public.agents a
    join public.members m on m.id = a.member_id
   where m.hive_id = p_hive
     and a.revoked_at is null
     and (a.expires_at is null or a.expires_at > now());

  select coalesce(jsonb_agg(jsonb_build_object(
           'from', l.from_note,
           'to', l.to_note,
           'tier', l.tier,
           'score', l.score
         ) order by l.created_at, l.id), '[]'::jsonb)
    into v_links
    from public.links l
   where l.hive_id = p_hive
     and l.status = 'accepted'
     and exists (select 1 from public.notes n
                  where n.hive_id = p_hive
                    and n.id in (l.from_note, l.to_note)
                    and n.member_id = v_me)
     and l.from_note = any (v_open)
     and l.to_note = any (v_open);

  return jsonb_build_object(
    'members', v_members,
    'agents', v_agents,
    'nodes', v_nodes,
    'links', v_links,
    'truncated', v_total > v_cap);
end
$$;

create or replace function public.inbox(p_hive uuid) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_cap constant integer := 100;
  v_me uuid;
  v_links jsonb;
  v_links_total bigint;
  v_held jsonb;
  v_held_total bigint;
begin
  if public.jwt_oauth_client() is not null then
    raise exception 'an app pass cannot do this';
  end if;
  -- People only. A self-hosted claim without an agent id is refused as well.
  if public.jwt_agent_id() is not null or public.jwt_is_self_hosted() then
    raise exception 'inbox is for people';
  end if;
  select m.id into v_me from public.members m
   where m.hive_id = p_hive and m.user_id = (select auth.uid());
  if v_me is null then
    raise exception 'not a member of this hive';
  end if;

  -- Proposed links with one note of the caller's whose side is not accepted.
  -- A proposed link always has two different owners (two notes of one owner
  -- are accepted at once), so `mine` matches one row per link.
  -- Readability is decided with the internal _can_read_note, as in map_graph:
  -- `theirs` is a stored row of this hive.
  with waiting as (
    select l.id, l.tier, l.created_at,
           (mine.id = l.from_note) as from_mine,
           (case when mine.id = l.from_note then l.to_accepted_at
                 else l.from_accepted_at end) is not null as they_accepted,
           mine.id as mine_id, mine.title as mine_title, mine.path as mine_path,
           mine.workspace_id as mine_ws,
           o.display_name as their_name,
           public.note_topic(theirs.path) as their_topic,
           case when public._can_read_note(theirs) then theirs.title end as their_title,
           count(*) over () as total
      from public.links l
      join public.notes mine
        on mine.id in (l.from_note, l.to_note)
       and mine.member_id = v_me and mine.hive_id = p_hive
      join public.notes theirs
        on theirs.id = case when mine.id = l.from_note then l.to_note else l.from_note end
       and theirs.hive_id = p_hive
      join public.members o on o.id = theirs.member_id and o.hive_id = p_hive
     where l.hive_id = p_hive
       and l.status = 'proposed'
       and (case when mine.id = l.from_note then l.from_accepted_at
                 else l.to_accepted_at end) is null
       and not mine.quarantined
       and not theirs.quarantined
     order by l.created_at desc, l.id
     limit v_cap
  )
  select coalesce(max(w.total), 0),
         coalesce(jsonb_agg(jsonb_build_object(
           'id', w.id,
           'tier', w.tier,
           'created_at', w.created_at,
           'proposed_by', case when w.from_mine then 'mine'::text else 'theirs'::text end,
           'they_accepted', w.they_accepted,
           'mine', jsonb_build_object(
             'id', w.mine_id, 'title', w.mine_title, 'path', w.mine_path,
             'workspace_id', w.mine_ws),
           'theirs', jsonb_build_object(
             'member_name', w.their_name, 'topic', w.their_topic, 'title', w.their_title)
         ) order by w.created_at desc, w.id), '[]'::jsonb)
    into v_links_total, v_links
    from waiting w;

  -- The caller's own held notes. The agent is named only when it is theirs.
  with held as (
    select n.id, n.title, n.path, n.workspace_id, n.updated_at, a.name as agent_name,
           count(*) over () as total
      from public.notes n
      left join public.agents a on a.id = n.written_by_agent and a.member_id = v_me
     where n.member_id = v_me and n.hive_id = p_hive and n.quarantined
     order by n.updated_at desc, n.id
     limit v_cap
  )
  select coalesce(max(h.total), 0),
         coalesce(jsonb_agg(jsonb_build_object(
           'id', h.id, 'title', h.title, 'path', h.path,
           'workspace_id', h.workspace_id, 'agent_name', h.agent_name,
           'updated_at', h.updated_at
         ) order by h.updated_at desc, h.id), '[]'::jsonb)
    into v_held_total, v_held
    from held h;

  return jsonb_build_object(
    'links', v_links, 'links_total', v_links_total,
    'held', v_held, 'held_total', v_held_total);
end
$$;

create or replace function public.inbox_count(p_hive uuid) returns integer
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_me uuid;
begin
  if public.jwt_oauth_client() is not null then
    raise exception 'an app pass cannot do this';
  end if;
  if public.jwt_agent_id() is not null or public.jwt_is_self_hosted() then
    raise exception 'inbox is for people';
  end if;
  select m.id into v_me from public.members m
   where m.hive_id = p_hive and m.user_id = (select auth.uid());
  if v_me is null then
    raise exception 'not a member of this hive';
  end if;
  return (
    select count(*)
      from public.links l
      join public.notes mine
        on mine.id in (l.from_note, l.to_note)
       and mine.member_id = v_me and mine.hive_id = p_hive
      join public.notes theirs
        on theirs.id = case when mine.id = l.from_note then l.to_note else l.from_note end
       and theirs.hive_id = p_hive
      join public.members o on o.id = theirs.member_id and o.hive_id = p_hive
     where l.hive_id = p_hive
       and l.status = 'proposed'
       and (case when mine.id = l.from_note then l.from_accepted_at
                 else l.to_accepted_at end) is null
       and not mine.quarantined
       and not theirs.quarantined
  ) + (
    select count(*) from public.notes n
     where n.member_id = v_me and n.hive_id = p_hive and n.quarantined
  );
end
$$;

create or replace function public.create_hive(p_name text, p_display_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_hive uuid;
  v_member uuid;
begin
  if public.jwt_oauth_client() is not null then
    raise exception 'an app pass cannot do this';
  end if;
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

create or replace function public.add_member(p_hive uuid, p_email text, p_display_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid;
  v_member uuid;
begin
  if public.jwt_oauth_client() is not null then
    raise exception 'an app pass cannot do this';
  end if;
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

create or replace function public.create_agent(
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
  if public.jwt_oauth_client() is not null then
    raise exception 'an app pass cannot do this';
  end if;
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

create or replace function public.revoke_agent(p_agent uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if public.jwt_oauth_client() is not null then
    raise exception 'an app pass cannot do this';
  end if;
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

create or replace function public.respond_to_link(p_link uuid, p_accept boolean) returns public.link_status
language plpgsql security definer set search_path = '' as $$
declare
  l public.links;
  mine_from boolean;
  mine_to boolean;
begin
  if public.jwt_oauth_client() is not null then
    raise exception 'an app pass cannot do this';
  end if;
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

create or replace function public.invite_member(p_hive uuid, p_email text, p_display_name text)
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
  if public.jwt_oauth_client() is not null then
    raise exception 'an app pass cannot do this';
  end if;
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

create or replace function public.revoke_invitation(p_invitation uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_hive uuid;
  v_email text;
begin
  if public.jwt_oauth_client() is not null then
    raise exception 'an app pass cannot do this';
  end if;
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

create or replace function public.claim_invitations() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text;
  v_member uuid;
  v_joined integer := 0;
  inv record;
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

-- ---------------------------------------------------------- connected apps

-- Connect an app to one of the caller's own workspaces, or reconnect it.
-- Called by the approval window as the signed-in person. Returns the agent.
create function public.connect_app(
  p_client_id text, p_name text, p_redirect_host text, p_workspace uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_trusted constant text[] := array['claude.ai', 'claude.com', 'chatgpt.com', 'openai.com'];
  v_host text := lower(coalesce(p_redirect_host, ''));
  v_uid uuid := (select auth.uid());
  v_member uuid;
  v_hive uuid;
  v_tier public.trust_tier := 'self_hosted';
  v_agent uuid;
begin
  if public.jwt_oauth_client() is not null then
    raise exception 'an app pass cannot do this';
  end if;
  if v_uid is null or public.jwt_agent_id() is not null or public.jwt_is_self_hosted() then
    raise exception 'only a person can connect an app';
  end if;
  if length(coalesce(p_client_id, '')) not between 1 and 200 then
    raise exception 'an app needs a client id of 1 to 200 characters';
  end if;
  if length(coalesce(p_name, '')) not between 1 and 120 then
    raise exception 'an app needs a name of 1 to 120 characters';
  end if;
  select m.id, m.hive_id into v_member, v_hive
    from public.workspaces w join public.members m on m.id = w.member_id
   where w.id = p_workspace and m.user_id = v_uid;
  if v_member is null then
    raise exception 'that workspace is not yours';
  end if;

  -- Trusted only when the host is a plain host name that equals a listed
  -- domain or ends with a dot and one. Compared without like, and anything
  -- that is not a bare host name (a path, a port, a query) is not trusted.
  if v_host ~ '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$'
     and exists (select 1 from unnest(v_trusted) d
                  where v_host = d or right(v_host, length(d) + 1) = '.' || d) then
    v_tier := 'vendor';
  end if;
  -- The least trust sticks: an app this person ever connected from an unknown
  -- address is not lifted to vendor by a later approval from a known one. An
  -- app can register several redirect addresses, and its earlier passes stay
  -- valid.
  if exists (select 1 from public.agents a join public.members m on m.id = a.member_id
              where m.user_id = v_uid and a.oauth_client_id = p_client_id
                and a.trust_tier = 'self_hosted') then
    v_tier := 'self_hosted';
  end if;

  -- A pass names the person and the app, not a hive: the person has one live
  -- agent per app, the one approved last.
  update public.agents a set revoked_at = now()
    from public.members m
   where m.id = a.member_id and m.user_id = v_uid
     and a.oauth_client_id = p_client_id
     and a.member_id <> v_member
     and a.revoked_at is null;

  insert into public.agents (member_id, workspace_id, name, provider, trust_tier, oauth_client_id)
    values (v_member, p_workspace, p_name, 'Connected app', v_tier, p_client_id)
    on conflict (member_id, oauth_client_id) where oauth_client_id is not null
    do update set workspace_id = excluded.workspace_id,
                  name = excluded.name,
                  trust_tier = excluded.trust_tier,
                  revoked_at = null,
                  expires_at = null
    returning id into v_agent;

  insert into public.audit_log (hive_id, member_id, action, detail)
    values (v_hive, v_member, 'agent.connected',
            jsonb_build_object('agent', v_agent, 'client_id', p_client_id,
                               'workspace', p_workspace, 'trust_tier', v_tier,
                               'redirect_host', left(v_host, 255)));
  return v_agent;
end
$$;

-- The connector exchanges an app pass for the identity it should act as: the
-- same columns as agent_login. Only for a caller that carries a client_id and
-- is a person behind it; it finds that person's own live agent for that app.
create function public.connector_login()
returns table (agent_id uuid, user_id uuid, member_id uuid, workspace_id uuid,
               hive_id uuid, trust_tier public.trust_tier)
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_client text := public.jwt_oauth_client();
  v_agent uuid;
begin
  if v_uid is null or v_client is null or public.jwt_agent_id() is not null then
    raise exception 'only a connected app can do this';
  end if;
  select a.id into v_agent
    from public.agents a join public.members m on m.id = a.member_id
   where m.user_id = v_uid
     and a.oauth_client_id = v_client
     and a.revoked_at is null
     and (a.expires_at is null or a.expires_at > now())
   order by a.created_at desc, a.id
   limit 1;
  if v_agent is null then
    raise exception 'no connected agent for this app';
  end if;
  update public.agents set last_used_at = now() where id = v_agent;
  return query
    select a.id, m.user_id, m.id, a.workspace_id, m.hive_id, a.trust_tier
      from public.agents a join public.members m on m.id = a.member_id
     where a.id = v_agent;
end
$$;

-- ------------------------------------------------------------------ grants

-- create or replace keeps the grants of the functions replaced above.
revoke all on function
  public.connect_app(text, text, text, uuid),
  public.connector_login()
from public, anon;
grant execute on function
  public.connect_app(text, text, text, uuid),
  public.connector_login()
to authenticated;
