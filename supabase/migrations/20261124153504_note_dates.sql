-- 20261124153504_note_dates.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp). Do not hand-edit
-- the version, and never edit a migration that has shipped.
--
-- What this migration does:
--   A note keeps the date it was written. The app is about to import folders
--   of notes that were written long ago, and the map is about to place a note
--   by when it was written, so notes.created_at and notes.updated_at get rules
--   (until now nothing checked them: any writer could send any value), and the
--   map's payload carries created_at.
--
--   - public.notes_before_write: replaced. It is the definition of
--     20261122115431_folder_rules_by_path.sql with the date rules added and
--     nothing else changed. Who the caller is decides:
--       * An agent, a connected app's pass, a token made for another audience
--         or a self-hosted claim (jwt_agent_id(), jwt_oauth_client(),
--         jwt_is_self_hosted()). On insert created_at and updated_at are now,
--         whatever was sent. On update created_at keeps its old value, and so
--         does updated_at unless the content changes.
--       * A person: a signed-in session with none of the above. They may set
--         both dates of their own notes (row-level security still decides
--         whose notes they write). A value in the future is cut back to now,
--         and updated_at is never before created_at: it is raised to it. On
--         update this is looked at only when the update changes one of the
--         two dates, so an update that sends no date (sharing, a move)
--         changes no date. A date set to null keeps its old value.
--       * The server with no person behind the call: no agent, no app and no
--         auth.uid(), which is the database's owner and the service key. It
--         is not checked, as before this migration. Nobody reaches that
--         through the API as anon or with a signed-in token: row-level
--         security refuses a note written or changed by a caller with no
--         member. The tests (old rows put in directly) and server scripts
--         rely on it.
--     A change of title, body or frontmatter stamps updated_at as now for
--     every caller, as before. A person's update of the dates alone changes
--     no content, so it makes no new version and leaves written_by_agent.
--   - public.map_graph: replaced. It is the definition of
--     20261123150712_connected_apps.sql with one more field on every item:
--     'created_at' (a note's created_at; a file's created_at, which is also
--     its 'updated_at', as before). A locked item carries it too: it says no
--     more than 'updated_at', which a locked item already carries. Who may
--     call it, which items are picked (the 5,000 with the newest change) and
--     their order are unchanged.
--
--   What it leaves alone: no table, column, index, policy or grant changes
--   (create or replace keeps each function's owner and grants), no stored row
--   is rewritten, and the audit log still records the real time of every
--   entry.

-- ----------------------------------------------------------------- triggers

create or replace function public.notes_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  w public.workspaces;
  agent uuid := public.jwt_agent_id();
  -- An agent or an app: its dates are the real moment.
  limited boolean := public.jwt_agent_id() is not null
                  or public.jwt_oauth_client() is not null
                  or public.jwt_is_self_hosted();
  -- A signed-in person: may set the two dates, within the rules below.
  person boolean;
begin
  person := not limited and (select auth.uid()) is not null;

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
    if limited then
      new.created_at := now();
      new.updated_at := now();
    elsif person then
      new.created_at := least(coalesce(new.created_at, now()), now());
      new.updated_at := least(
        greatest(coalesce(new.updated_at, now()), new.created_at), now());
    end if;
    return new;
  end if;

  if new.member_id <> old.member_id or new.workspace_id <> old.workspace_id
     or new.hive_id <> old.hive_id then
    raise exception 'a note cannot move to another member, workspace or hive';
  end if;
  if agent is not null and new.path <> old.path then
    raise exception 'agents cannot move a note';
  end if;
  if agent is not null and (
       new.visibility is distinct from old.visibility
    or new.shared_with <> old.shared_with
    or new.quarantined <> old.quarantined
    or new.folder_id is distinct from old.folder_id) then
    raise exception 'agents cannot change sharing';
  end if;
  if limited then
    new.created_at := old.created_at;
  elsif person and new.created_at is distinct from old.created_at then
    new.created_at := least(coalesce(new.created_at, old.created_at), now());
  end if;
  if new.title <> old.title or new.body <> old.body or new.frontmatter <> old.frontmatter then
    new.version := old.version + 1;
    new.updated_at := now();
    new.written_by_agent := agent;
  else
    new.version := old.version;
    if limited then
      new.updated_at := old.updated_at;
    elsif person and (new.updated_at is distinct from old.updated_at
                      or new.created_at is distinct from old.created_at) then
      new.updated_at := least(
        greatest(coalesce(new.updated_at, old.updated_at), new.created_at), now());
    end if;
  end if;
  return new;
end
$$;

-- ---------------------------------------------------------------- map_graph

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
    select p.id, p.kind, p.updated_at, n.created_at, p.total,
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
    select p.id, p.kind, p.updated_at, f.created_at, p.total,
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
           'created_at', k.created_at,
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
