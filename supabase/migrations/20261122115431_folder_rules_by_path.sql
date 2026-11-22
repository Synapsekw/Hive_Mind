-- 20261122115431_folder_rules_by_path.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp). Do not hand-edit
-- the version, and never edit a migration that has shipped.
--
-- What this migration does:
--   Folder rules follow the path. A note's sharing is its own setting, else
--   the rule of the nearest folder above it by path in the same workspace
--   (a folder record with no rule is transparent), else the member's default.
--   notes.folder_id is no longer read for sharing.
--
--   - Internal, executable by nobody: note_folder_rule, _note_visibility,
--     _note_shared_with, _can_read_note, _is_mine. They compute from the row
--     as passed. can_read_note (the notes_select policy), note_access,
--     note_rule_folder, map_graph and the audit trigger use them.
--   - public.can_read_note / note_visibility / note_shared_with: replaced.
--     They answer from the passed row only for the caller's own notes, and
--     otherwise from the stored row the caller can read, so a forged row
--     (a known id or workspace plus a guessed path) reveals nothing.
--   - public.map_graph: replaced, identical but for _can_read_note.
--   - public.note_rule_folder(notes), public.note_access(notes): new computed
--     columns on notes, so the app can say where a note's sharing comes from.
--   - public.folder_share_preview(workspace, path): exact counts for the
--     sentence shown before a folder's rule is saved.
--   - notes_before_write: an agent can no longer change a note's path (with
--     path-based rules, moving a note would change its sharing).
--   - notes_audit / folders_audit: every sharing change made by a person
--     writes one audit_log row (including moving a note, renaming or deleting
--     a rule folder). A note row carries the note id and the before and after
--     values only, never the note's path, title or body.
--   - folders_before_write now runs on update too, and refuses moving a
--     folder row to another member or workspace.
--   - note_visibility, note_shared_with and can_read_note are revoked from
--     public and anon.
--
--   Security definer functions bypass row-level security, so each one below
--   decides explicitly what the caller may learn.

-- ------------------------------------------------------------ folder rules

-- The folder row with a rule whose path is a proper ancestor of the note's
-- path, nearest first. Compared without `like`, so `%` and `_` in a folder
-- name match literally; case-sensitive. Only the note owner's own folders
-- count.
--
-- Internal helpers: note_folder_rule, _note_visibility, _note_shared_with and
-- _can_read_note compute from the row as passed, with no caller check. Nobody
-- may execute them (not even authenticated); only security definer code in
-- this schema calls them, and only on stored rows or on the caller's own.
-- plpgsql, so its plans are cached: measured faster under row-level security
-- than the single SQL statement.
create function public.note_folder_rule(n public.notes) returns public.folders
language plpgsql stable security definer set search_path = '' as $$
declare
  f public.folders;
begin
  select * into f
    from public.folders x
   where x.workspace_id = n.workspace_id
     and x.member_id = n.member_id
     and x.visibility is not null
     and left(n.path, length(x.path) + 1) = x.path || '/'
   order by length(x.path) desc
   limit 1;
  if f.id is null then
    return null;
  end if;
  return f;
end
$$;

-- Note override, else the nearest folder rule, else the member's default.
create function public._note_visibility(n public.notes)
returns public.visibility
language sql stable security definer set search_path = '' as $$
  select coalesce(
    n.visibility,
    (select r.visibility from public.note_folder_rule(n) r),
    (select m.default_visibility from public.members m where m.id = n.member_id)
  )
$$;

create function public._note_shared_with(n public.notes) returns uuid[]
language sql stable security definer set search_path = '' as $$
  select case
    when n.visibility is not null then n.shared_with
    else coalesce((select r.shared_with from public.note_folder_rule(n) r), '{}')
  end
$$;

-- The rule shipped in 20261120000002, unchanged in meaning, now on the
-- internal rule lookup. plpgsql so the effective sharing is resolved once and
-- each step's plan is cached (it runs once per row under RLS).
create function public._can_read_note(n public.notes) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_mine uuid[] := array(select m.id from public.members m
                          where m.user_id = (select auth.uid()));
  v_agent uuid := public.jwt_agent_id();
  v_vis public.visibility;
  v_with uuid[];
  f public.folders;
begin
  -- Your own notes. A self-hosted agent only sees what it wrote itself.
  if n.member_id = any (v_mine) and not public.jwt_is_self_hosted() then
    return true;
  end if;
  if v_agent is not null and n.written_by_agent = v_agent then
    return true;
  end if;
  -- Shared notes: never while quarantined, and only inside your hive.
  if n.quarantined or not exists (select 1 from public.members m
                                   where m.hive_id = n.hive_id
                                     and m.user_id = (select auth.uid())) then
    return false;
  end if;
  if n.visibility is not null then
    v_vis := n.visibility;
    v_with := n.shared_with;
  else
    f := public.note_folder_rule(n);
    if f.id is not null then
      v_vis := f.visibility;
      v_with := f.shared_with;
    else
      select m.default_visibility into v_vis from public.members m where m.id = n.member_id;
      v_with := '{}';
    end if;
  end if;
  if v_vis = 'group' or (v_vis = 'members' and v_with && v_mine) then
    return true;
  end if;
  -- A link both owners accepted opens the two notes to each other.
  return exists (
    select 1
      from public.links l
      join public.notes o
        on o.id = case when l.from_note = n.id then l.to_note else l.from_note end
     where l.status = 'accepted'
       and n.id in (l.from_note, l.to_note)
       and o.member_id = any (v_mine));
end
$$;

-- The public versions are what row-level security and the API call. They
-- answer from the row as passed only when it is the caller's own (n.member_id
-- is one of the caller's members: the rule lookup is limited to that member's
-- folders, so a forged workspace id reveals nothing). This keeps a new row
-- working in insert/update ... returning. For anyone else they answer from the
-- stored row with that id, and only when the caller can read it: a forged row
-- (a known note id or workspace id plus a guessed path) tells a non-reader
-- nothing, so the path of a locked note cannot be tested.
--
-- can_read_note is the notes_select policy. For someone else's note it costs
-- one primary-key lookup; under RLS the stored row is the row being checked.
-- True when n.member_id is one of the caller's members.
create function public._is_mine(n public.notes) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.members m
                  where m.id = n.member_id and m.user_id = (select auth.uid()))
$$;

-- plpgsql (was sql): the branches and plans are cheaper per row under RLS.
create or replace function public.can_read_note(n public.notes) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  x public.notes;
begin
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

create or replace function public.note_visibility(n public.notes)
returns public.visibility
language plpgsql stable security definer set search_path = '' as $$
declare
  x public.notes;
begin
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

-- The path of the note's rule folder, or null. Decided on the stored row, and
-- null when the caller cannot read that note, so a forged row reveals nothing.
create function public.note_rule_folder(n public.notes) returns text
language sql stable security definer set search_path = '' as $$
  select (select r.path from public.note_folder_rule(x) r)
    from public.notes x
   where x.id = n.id
     and public._can_read_note(x)
$$;

-- Why the caller can read the note: 'own', 'shared' (the whole hive, or named
-- members including the caller) or 'link' (only through an accepted link).
-- Null when the caller cannot read it.
create function public.note_access(n public.notes) returns text
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
     and public._can_read_note(x)
$$;

-- Exact counts for the notes under p_path in one of the caller's workspaces:
--   follows           no setting of their own and no nearer rule folder
--   own_setting       a setting of their own
--   under_nested_rule no setting of their own, but a rule folder below p_path
--   held              quarantined, among follows
create function public.folder_share_preview(p_workspace uuid, p_path text)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_owner uuid;
  v_result jsonb;
begin
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

-- ----------------------------------------------------------------- triggers

-- As before, plus: an agent cannot change a note's path.
create or replace function public.notes_before_write() returns trigger
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

-- One audit row per sharing change by a signed-in person. Agents are refused
-- sharing changes before this runs. Writes with no person behind them (no
-- auth.uid()) are not audited. Never the note's path, title or body.
--
-- A person moving a note (a path change) changes its sharing when the folder
-- rule above it changes: that writes one row with the effective values before
-- and after and "moved": true. It replaces the plain row for the same update.
create function public.notes_audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_member uuid;
  v_from jsonb := jsonb_build_object('visibility', null, 'shared_with', '[]'::jsonb);
  v_changed boolean;
  v_eff_from jsonb;
  v_eff_to jsonb;
begin
  if (select auth.uid()) is null then
    return null;
  end if;
  if tg_op = 'INSERT' then
    v_changed := new.visibility is not null;
  else
    v_changed := new.visibility is distinct from old.visibility
              or new.shared_with is distinct from old.shared_with;
    v_from := jsonb_build_object('visibility', old.visibility,
                                 'shared_with', to_jsonb(old.shared_with));
  end if;
  select m.id into v_member from public.members m
   where m.hive_id = new.hive_id and m.user_id = (select auth.uid());

  if tg_op = 'UPDATE' and new.path <> old.path then
    v_eff_from := jsonb_build_object('visibility', public._note_visibility(old),
                                     'shared_with', to_jsonb(public._note_shared_with(old)));
    v_eff_to := jsonb_build_object('visibility', public._note_visibility(new),
                                   'shared_with', to_jsonb(public._note_shared_with(new)));
    if v_eff_from <> v_eff_to then
      insert into public.audit_log (hive_id, member_id, agent_id, action, note_id, detail)
      values (new.hive_id, v_member, public.jwt_agent_id(), 'note.sharing', new.id,
              jsonb_build_object('from', v_eff_from, 'to', v_eff_to, 'moved', true));
      v_changed := false;
    end if;
  end if;

  if v_changed then
    insert into public.audit_log (hive_id, member_id, agent_id, action, note_id, detail)
    values (new.hive_id, v_member, public.jwt_agent_id(), 'note.sharing', new.id,
            jsonb_build_object(
              'from', v_from,
              'to', jsonb_build_object('visibility', new.visibility,
                                       'shared_with', to_jsonb(new.shared_with))));
  end if;
  if tg_op = 'UPDATE' then
    if old.quarantined and not new.quarantined then
      insert into public.audit_log (hive_id, member_id, agent_id, action, note_id, detail)
      values (new.hive_id, v_member, public.jwt_agent_id(), 'note.released', new.id, '{}');
    end if;
  end if;
  return null;
end
$$;

create trigger notes_audit after insert or update on public.notes
  for each row execute function public.notes_audit();

-- A folder row carries the folder's path: a rule means nothing without it.
-- Written when a folder that has or gets a rule is created, changes its rule,
-- is renamed ("path" is the old path, "new_path" the new one) or is deleted
-- ("to": null).
create function public.folders_audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_row public.folders;
  v_hive uuid;
  v_member uuid;
  v_none jsonb := jsonb_build_object('visibility', null, 'shared_with', '[]'::jsonb);
  v_detail jsonb;
begin
  if (select auth.uid()) is null then
    return null;
  end if;
  if tg_op = 'INSERT' then
    if new.visibility is null then
      return null;
    end if;
    v_row := new;
    v_detail := jsonb_build_object(
      'path', new.path,
      'from', v_none,
      'to', jsonb_build_object('visibility', new.visibility,
                               'shared_with', to_jsonb(new.shared_with)));
  elsif tg_op = 'DELETE' then
    if old.visibility is null then
      return null;
    end if;
    v_row := old;
    v_detail := jsonb_build_object(
      'path', old.path,
      'from', jsonb_build_object('visibility', old.visibility,
                                 'shared_with', to_jsonb(old.shared_with)),
      'to', null);
  else
    if old.visibility is null and new.visibility is null then
      return null;
    end if;
    if new.visibility is not distinct from old.visibility
       and new.shared_with is not distinct from old.shared_with
       and new.path = old.path then
      return null;
    end if;
    v_row := new;
    v_detail := jsonb_build_object(
      'path', old.path,
      'from', jsonb_build_object('visibility', old.visibility,
                                 'shared_with', to_jsonb(old.shared_with)),
      'to', jsonb_build_object('visibility', new.visibility,
                               'shared_with', to_jsonb(new.shared_with)));
    if new.path <> old.path then
      v_detail := v_detail || jsonb_build_object('new_path', new.path);
    end if;
  end if;

  -- Gone when the folder goes with its workspace or hive: no note outlives
  -- it, so there is nothing to record.
  select w.hive_id into v_hive
    from public.workspaces w join public.hives h on h.id = w.hive_id
   where w.id = v_row.workspace_id;
  if v_hive is null then
    return null;
  end if;
  select m.id into v_member from public.members m
   where m.hive_id = v_hive and m.user_id = (select auth.uid());
  insert into public.audit_log (hive_id, member_id, agent_id, action, note_id, detail)
  values (v_hive, v_member, public.jwt_agent_id(), 'folder.sharing', null, v_detail);
  return null;
end
$$;

create trigger folders_audit after insert or update or delete on public.folders
  for each row execute function public.folders_audit();

-- As before, and on update too: a folder cannot be moved to another member
-- or workspace. With path-based rules, re-pointing one's own folder row at
-- someone else's workspace would share their notes.
create or replace function public.folders_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and (new.workspace_id <> old.workspace_id
                           or new.member_id <> old.member_id) then
    raise exception 'a folder cannot move to another member or workspace';
  end if;
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

drop trigger folders_before_write on public.folders;
create trigger folders_before_write before insert or update on public.folders
  for each row execute function public.folders_before_write();

-- ---------------------------------------------------------------- map_graph

-- As shipped in 20261122083415, except that readability is decided with the
-- internal _can_read_note: every row here is a stored row filtered by p_hive,
-- so the public wrapper's stored-row lookup would only repeat work.
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

-- ------------------------------------------------------------------ grants

revoke all on function
  public.note_folder_rule(public.notes),
  public._note_visibility(public.notes),
  public._note_shared_with(public.notes),
  public._can_read_note(public.notes),
  public._is_mine(public.notes),
  public.notes_audit(),
  public.folders_audit()
from public, anon, authenticated;

-- note_visibility, note_shared_with and can_read_note were executable by
-- public and anon since the sharing rules shipped. Row-level security on
-- notes is `to authenticated`, and computed columns matter only to signed-in
-- callers, so the public loses them.
revoke all on function
  public.note_visibility(public.notes),
  public.note_shared_with(public.notes),
  public.can_read_note(public.notes),
  public.note_rule_folder(public.notes),
  public.note_access(public.notes),
  public.folder_share_preview(uuid, text)
from public, anon;
grant execute on function
  public.note_visibility(public.notes),
  public.note_shared_with(public.notes),
  public.can_read_note(public.notes),
  public.note_rule_folder(public.notes),
  public.note_access(public.notes),
  public.folder_share_preview(uuid, text)
to authenticated;
