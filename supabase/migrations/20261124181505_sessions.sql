-- 20261124181505_sessions.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp). Do not hand-edit
-- the version, and never edit a migration that has shipped.
--
-- What this migration does:
--   Records an agent's working run as a session, tags every note and file it
--   writes with it, and closes it into a session note.
--
--   - public.sessions: one row per run. Read by its owner, or by anyone who can
--     read its session note. Written only by the functions below.
--   - notes.session_id, files.session_id: filled by the tagging trigger, never
--     by the client. The key comes from the request header x-hive-session
--     (stdio MCP: one per process; no header: 'default').
--   - session_end(title, summary): an agent closes its open session; writes
--     the session note at Sessions/<date> <title>.md (sharing inherited, like
--     any note), lists what the session produced as plain text (no wiki links,
--     which would propose links), and makes that note the home of the
--     session's files that have none.
--   - close_idle_sessions(): the scheduled sweep (scripts/setup-session-sweep.sh)
--     closes sessions idle for two hours. An idle session is also closed by
--     its agent's next write.
--   - upload_session_open/end, session_retitle: a person's upload batch and a
--     person retitling their own session.

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  hive_id uuid not null references public.hives on delete cascade,
  member_id uuid not null references public.members on delete cascade,
  workspace_id uuid not null references public.workspaces on delete cascade,
  agent_id uuid references public.agents on delete set null,
  agent_name text not null,
  client_key text not null,
  title text,
  summary text,
  note_id uuid references public.notes on delete set null,
  started_at timestamptz not null default now(),
  last_active_at timestamptz not null default now(),
  ended_at timestamptz
);
create unique index sessions_open_key on public.sessions (member_id, client_key)
  where ended_at is null;
create index sessions_hive_started_idx on public.sessions (hive_id, started_at desc);
create index sessions_idle_idx on public.sessions (last_active_at) where ended_at is null;
create index sessions_note_idx on public.sessions (note_id);

alter table public.sessions enable row level security;
create policy sessions_select on public.sessions for select to authenticated
  using ((member_id in (select public.my_member_ids()) and not public.jwt_is_self_hosted())
         or exists (select 1 from public.notes n where n.id = note_id));
create policy sessions_no_app on public.sessions as restrictive for all to authenticated
  using (public.jwt_oauth_client() is null)
  with check (public.jwt_oauth_client() is null);

alter table public.notes add column session_id uuid references public.sessions on delete set null;
alter table public.files add column session_id uuid references public.sessions on delete set null;
create index notes_session_idx on public.notes (session_id);
create index files_session_idx on public.files (session_id);

-- ------------------------------------------------------------ the key

create function public.request_session_key() returns text
language sql stable set search_path = '' as $$
  select case
    when k ~ '^[A-Za-z0-9-]{1,64}$' then k
    else 'default'
  end
  from (select coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb
               ->> 'x-hive-session' as k) h
$$;

-- ------------------------------------------------------------ closing

-- Always neutral: the agent and the day. Never derived from what the session
-- produced (a storage folder names a customer), since the session note's sharing
-- is inherited. A title given to session_end is used instead.
create function public._session_title(s public.sessions) returns text
language sql stable security definer set search_path = '' as $$
  select 'Session · ' || s.agent_name || ' · '
    || to_char(s.started_at at time zone 'UTC', 'YYYY-MM-DD')
$$;

-- Closes one open session: writes its note, homes its homeless files. Returns
-- the note id. Internal.
create function public._close_session(p_id uuid, p_title text, p_summary text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  s public.sessions;
  v_title text;
  v_body text;
  v_base text;
  v_path text;
  v_n int := 1;
  v_note uuid;
  v_notes int;
  v_files int;
begin
  select * into s from public.sessions where id = p_id for update;
  if not found then raise exception 'no such session'; end if;
  if s.ended_at is not null then return s.note_id; end if;

  v_title := coalesce(nullif(btrim(p_title), ''), public._session_title(s));
  -- Counts only: titles, paths and file names of what the session produced may
  -- be private, and this note's sharing is inherited. The app lists the
  -- contents from session_id, under each reader's own access.
  select count(*) into v_notes from public.notes n where n.session_id = s.id;
  select count(*) into v_files from public.files f where f.session_id = s.id;
  v_body := coalesce(nullif(btrim(p_summary), ''), 'Closed automatically.')
    || E'\n\n## Produced in this session\n'
    || v_notes || case when v_notes = 1 then ' note, ' else ' notes, ' end
    || v_files || case when v_files = 1 then ' file' else ' files' end
    || '. Open the session in the gallery to see them.';

  v_base := 'Sessions/' || to_char(s.started_at at time zone 'UTC', 'YYYY-MM-DD') || ' '
    || left(regexp_replace(v_title, '[/\\\[\]#|^]', '-', 'g'), 80);
  v_path := v_base || '.md';
  while exists (select 1 from public.notes where workspace_id = s.workspace_id and path = v_path) loop
    v_n := v_n + 1;
    v_path := v_base || ' (' || v_n || ').md';
  end loop;

  -- The note belongs to this session; the tagging trigger reads this.
  perform set_config('hive.closing_session', s.id::text, true);
  insert into public.notes (hive_id, member_id, workspace_id, path, title, body)
  values (s.hive_id, s.member_id, s.workspace_id, v_path, v_title, v_body)
  returning id into v_note;
  perform set_config('hive.closing_session', '', true);

  update public.sessions
     set title = v_title,
         summary = coalesce(nullif(btrim(p_summary), ''), 'Closed automatically.'),
         note_id = v_note,
         ended_at = now()
   where id = s.id;
  update public.files set note_id = v_note where session_id = s.id and note_id is null;
  return v_note;
end
$$;

-- Opens the agent's session for a key, or joins the one already open: two first
-- writes of one key can run at once, and the one whose insert comes second gets
-- the first one's session (sessions_open_key) instead of a unique violation.
-- Internal.
create function public._open_agent_session(p_agent uuid, p_key text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  insert into public.sessions (hive_id, member_id, workspace_id, agent_id, agent_name, client_key)
  select w.hive_id, a.member_id, a.workspace_id, a.id, a.name, p_key
    from public.agents a join public.workspaces w on w.id = a.workspace_id
   where a.id = p_agent
  on conflict (member_id, client_key) where ended_at is null
  do update set last_active_at = now()
  returning id into v_id;
  return v_id;
end
$$;

-- The calling agent's open session for this request's key, opened or bumped.
-- An open session idle for two hours is closed first. Internal.
create function public._agent_session() returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  a public.agents;
  k text;
  s public.sessions;
begin
  select * into a from public.agents where id = public.jwt_agent_id();
  if not found then return null; end if;
  k := a.id::text || ':' || public.request_session_key();
  select * into s from public.sessions
   where member_id = a.member_id and client_key = k and ended_at is null
   for update;
  if found and s.last_active_at < now() - interval '2 hours' then
    perform public._close_session(s.id, null, null);
  elsif found then
    update public.sessions set last_active_at = now() where id = s.id;
    return s.id;
  end if;
  -- No open session (or it was just closed): open one. A concurrent first write
  -- of the same key may have opened it since the select; the upsert joins it.
  return public._open_agent_session(a.id, k);
end
$$;

-- ------------------------------------------------------------ tagging

create function public.tag_session() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_closing text := current_setting('hive.closing_session', true);
begin
  if v_closing is not null and v_closing <> '' then
    new.session_id := v_closing::uuid;
    return new;
  end if;
  if public.jwt_agent_id() is not null then
    if tg_op = 'INSERT' then
      new.session_id := public._agent_session();
    else
      perform public._agent_session();
      new.session_id := case
        when new.session_id is null and old.session_id is not null
             and not exists (select 1 from public.sessions s where s.id = old.session_id)
        then null  -- the foreign key emptying a deleted session's reference
        else old.session_id
      end;
    end if;
    return new;
  end if;
  if tg_op = 'UPDATE' then
    new.session_id := case
      when new.session_id is null and old.session_id is not null
           and not exists (select 1 from public.sessions s where s.id = old.session_id)
      then null  -- the foreign key emptying a deleted session's reference
      else old.session_id
    end;
    return new;
  end if;
  -- A person: only their own open upload session.
  if new.session_id is not null and not exists (
       select 1 from public.sessions s
        where s.id = new.session_id and s.agent_id is null and s.ended_at is null
          and s.member_id = new.member_id and s.workspace_id = new.workspace_id
          and s.member_id in (select public.my_member_ids())) then
    raise exception 'not your upload session';
  end if;
  return new;
end
$$;

create trigger notes_tag_session before insert or update on public.notes
  for each row execute function public.tag_session();
create trigger files_tag_session before insert on public.files
  for each row execute function public.tag_session();

-- ------------------------------------------------------------ callable

create function public.session_end(p_title text, p_summary text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  a public.agents;
  s public.sessions;
  v_note uuid;
begin
  if public.jwt_oauth_client() is not null then
    raise exception 'an app pass cannot do this';
  end if;
  if public.jwt_agent_id() is null then
    raise exception 'only an agent ends a session';
  end if;
  if p_title is null or char_length(btrim(p_title)) not between 1 and 120 then
    raise exception 'a session title is 1 to 120 characters';
  end if;
  if p_summary is not null and char_length(p_summary) > 4000 then
    raise exception 'a session summary is at most 4000 characters';
  end if;
  select * into a from public.agents where id = public.jwt_agent_id();
  select * into s from public.sessions
   where member_id = a.member_id
     and client_key = a.id::text || ':' || public.request_session_key()
     and ended_at is null;
  if not found then raise exception 'no open session: nothing was written in it yet'; end if;
  v_note := public._close_session(s.id, p_title, p_summary);
  return jsonb_build_object(
    'session_id', s.id,
    'note_id', v_note,
    'note_path', (select path from public.notes where id = v_note));
end
$$;

create function public.close_idle_sessions() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_n int := 0;
begin
  for v_id in
    select id from public.sessions
     where ended_at is null and agent_id is not null
       and last_active_at < now() - interval '2 hours'
       -- A hive being deleted takes no new note; its sessions wait for the
       -- erase (or for the deletion to be cancelled).
       and not public.hive_is_closing(hive_id)
     order by last_active_at limit 500
  loop
    perform public._close_session(v_id, null, null);
    v_n := v_n + 1;
  end loop;
  return v_n;
end
$$;

create function public.upload_session_open(p_workspace uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  w public.workspaces;
  v_id uuid;
begin
  if public.jwt_oauth_client() is not null then
    raise exception 'an app pass cannot do this';
  end if;
  if public.jwt_agent_id() is not null or (select auth.uid()) is null then
    raise exception 'only a person uploads in the app';
  end if;
  select * into w from public.workspaces
   where id = p_workspace and member_id in (select public.my_member_ids());
  if not found then raise exception 'not your workspace'; end if;
  if public.hive_is_closing(w.hive_id) then
    raise exception 'this hive is being deleted';
  end if;
  insert into public.sessions (hive_id, member_id, workspace_id, agent_name, client_key)
  values (w.hive_id, w.member_id, w.id, 'Browser upload', 'upload:' || gen_random_uuid())
  returning id into v_id;
  return v_id;
end
$$;

create function public.upload_session_end(p_session uuid, p_note uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if public.jwt_oauth_client() is not null then
    raise exception 'an app pass cannot do this';
  end if;
  if public.jwt_agent_id() is not null or (select auth.uid()) is null then
    raise exception 'only a person uploads in the app';
  end if;
  -- The note is in the session's own workspace: a session is read by whoever
  -- reads its note, so it must not be pointed at a note of another hive.
  if not exists (select 1 from public.notes n
                   join public.sessions x on x.id = p_session
                  where n.id = p_note and n.workspace_id = x.workspace_id
                    and n.member_id in (select public.my_member_ids())) then
    raise exception 'not your note';
  end if;
  update public.sessions
     set note_id = p_note,
         title = 'Upload · ' || to_char(started_at at time zone 'UTC', 'YYYY-MM-DD'),
         ended_at = now()
   where id = p_session and agent_id is null and ended_at is null
     and member_id in (select public.my_member_ids());
  if not found then raise exception 'not your upload session'; end if;
end
$$;

create function public.session_retitle(p_session uuid, p_title text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if public.jwt_oauth_client() is not null then
    raise exception 'an app pass cannot do this';
  end if;
  if public.jwt_agent_id() is not null or (select auth.uid()) is null then
    raise exception 'only a person retitles a session';
  end if;
  if p_title is null or char_length(btrim(p_title)) not between 1 and 120 then
    raise exception 'a session title is 1 to 120 characters';
  end if;
  update public.sessions set title = btrim(p_title)
   where id = p_session and member_id in (select public.my_member_ids());
  if not found then raise exception 'not your session'; end if;
end
$$;

revoke all on function public._session_title(public.sessions) from public, anon, authenticated;
revoke all on function public._close_session(uuid, text, text) from public, anon, authenticated;
revoke all on function public._agent_session() from public, anon, authenticated;
revoke all on function public._open_agent_session(uuid, text) from public, anon, authenticated;
revoke all on function public.tag_session() from public, anon, authenticated;
revoke all on function public.request_session_key() from public, anon, authenticated;
-- TRUNCATE fires no row trigger; the API has no call for it (see hive_deletion).
revoke truncate on public.sessions from anon, authenticated;
revoke all on function public.close_idle_sessions() from public, anon, authenticated;
revoke all on function public.session_end(text, text) from public, anon;
revoke all on function public.upload_session_open(uuid) from public, anon;
revoke all on function public.upload_session_end(uuid, uuid) from public, anon;
revoke all on function public.session_retitle(uuid, text) from public, anon;
grant execute on function public.session_end(text, text) to authenticated;
grant execute on function public.upload_session_open(uuid) to authenticated;
grant execute on function public.upload_session_end(uuid, uuid) to authenticated;
grant execute on function public.session_retitle(uuid, text) to authenticated;

-- ------------------------------------------------------------ hive erase

-- purge_hive as in 20261124091833_hive_deletion.sql, with one more step: the
-- sessions of the hive, after its notes and files and before its agents,
-- workspaces and members, whose foreign keys would otherwise empty or delete a
-- column of every session. Steps 8 to 15 there are 9 to 16 here. Sessions are
-- written only by the functions above, none of which writes into a closing
-- hive's notes, so they are not under the freeze.
create or replace function public.purge_hive(p_hive uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  c_budget constant integer := 2000;
  -- An agent, a workspace or a member costs this many rows of the budget:
  -- their foreign keys read tables that have no index on the column.
  c_heavy constant integer := 20;
  h public.hives;
  v_left integer := c_budget;
  v_step integer;
  v_cost integer;
  v_limit integer;
  v_n integer;
begin
  select * into h from public.hives x where x.id = p_hive for update;
  if h.id is null then
    raise exception 'hive not found';
  end if;
  if h.purging_at is null or h.delete_after is null or h.delete_after > now() then
    raise exception 'this hive is not due';
  end if;
  -- What lets these deletes past the freeze, for this hive and this
  -- transaction only (see hive_frozen).
  perform set_config('hive.purging', p_hive::text, true);

  for v_step in 1..16 loop
    -- How many rows of this table the rest of the budget pays for.
    v_cost := case when v_step >= 14 then c_heavy else 1 end;
    v_limit := greatest(v_left / v_cost, 1);
    v_n := 0;
    case v_step
      when 1 then
        delete from public.note_versions d
         where (d.note_id, d.version) in (
           select x.note_id, x.version
             from public.note_versions x join public.notes n on n.id = x.note_id
            where n.hive_id = p_hive
            limit v_limit);
        get diagnostics v_n = row_count;
      when 2 then
        -- By the note, then by the entity: a tag left across two hives is in
        -- one of the two.
        delete from public.note_entities d
         where (d.note_id, d.entity_id) in (
           select x.note_id, x.entity_id
             from public.note_entities x join public.notes n on n.id = x.note_id
            where n.hive_id = p_hive
            limit v_limit);
        get diagnostics v_n = row_count;
      when 3 then
        delete from public.note_entities d
         where (d.note_id, d.entity_id) in (
           select x.note_id, x.entity_id
             from public.note_entities x join public.entities e on e.id = x.entity_id
            where e.hive_id = p_hive
            limit v_limit);
        get diagnostics v_n = row_count;
      when 4 then
        delete from public.links d
         where d.id in (select x.id from public.links x
                         where x.hive_id = p_hive limit v_limit);
        get diagnostics v_n = row_count;
      when 5 then
        delete from public.files d
         where d.id in (select x.id from public.files x
                         where x.hive_id = p_hive limit v_limit);
        get diagnostics v_n = row_count;
      when 6 then
        delete from public.synthesis_pages d
         where d.entity_id in (
           select x.entity_id
             from public.synthesis_pages x join public.entities e on e.id = x.entity_id
            where e.hive_id = p_hive
            limit v_limit);
        get diagnostics v_n = row_count;
      when 7 then
        -- Versions, tags, links and file rows are gone: nothing follows a
        -- note.
        delete from public.notes d
         where d.id in (select x.id from public.notes x
                         where x.hive_id = p_hive limit v_limit);
        get diagnostics v_n = row_count;
      when 8 then
        -- A session's notes and files are gone, so nothing follows it. Before
        -- the agents, the workspaces and the members, whose foreign keys
        -- would otherwise empty or delete a column of every session.
        delete from public.sessions d
         where d.id in (select x.id from public.sessions x
                         where x.hive_id = p_hive limit v_limit);
        get diagnostics v_n = row_count;
      when 9 then
        delete from public.folders d
         where d.id in (
           select x.id
             from public.folders x join public.workspaces w on w.id = x.workspace_id
            where w.hive_id = p_hive
            limit v_limit);
        get diagnostics v_n = row_count;
      when 10 then
        delete from public.entities d
         where d.id in (select x.id from public.entities x
                         where x.hive_id = p_hive limit v_limit);
        get diagnostics v_n = row_count;
      when 11 then
        delete from public.invitations d
         where d.id in (select x.id from public.invitations x
                         where x.hive_id = p_hive limit v_limit);
        get diagnostics v_n = row_count;
      when 12 then
        delete from public.notifications d
         where d.id in (select x.id from public.notifications x
                         where x.hive_id = p_hive limit v_limit);
        get diagnostics v_n = row_count;
      when 13 then
        -- After the notes and the folders, whose triggers write here when a
        -- person is signed in. Before the agents and the members, whose
        -- foreign keys would otherwise empty a column of every row.
        delete from public.audit_log d
         where d.id in (select x.id from public.audit_log x
                         where x.hive_id = p_hive limit v_limit);
        get diagnostics v_n = row_count;
      when 14 then
        delete from public.agents d
         where d.id in (
           select x.id
             from public.agents x join public.members m on m.id = x.member_id
            where m.hive_id = p_hive
            limit v_limit);
        get diagnostics v_n = row_count;
      when 15 then
        delete from public.workspaces d
         where d.id in (select x.id from public.workspaces x
                         where x.hive_id = p_hive
                         limit v_limit);
        get diagnostics v_n = row_count;
      when 16 then
        -- The members are what the stored objects are found by (a path
        -- starts with a member's id), so they stay, and the hive with them,
        -- until the purge function has removed every object. The same range
        -- as hive_object_paths. What this call removed so far is kept; a
        -- call that could do nothing else says why.
        if exists (
             select 1
               from public.members m
               join storage.objects o
                 on o.bucket_id = 'files'
                and o.name collate "C" >= (m.id::text || '/') collate "C"
                and o.name collate "C" < (m.id::text || '0') collate "C"
              where m.hive_id = p_hive) then
          if v_left < c_budget then
            perform set_config('hive.purging', '', true);
            return false;
          end if;
          raise exception 'stored objects remain';
        end if;
        delete from public.members d
         where d.id in (select x.id from public.members x
                         where x.hive_id = p_hive
                         limit v_limit);
        get diagnostics v_n = row_count;
    end case;
    -- As many as the budget allowed: there may be more, and the tables
    -- after this one must wait for it to be empty.
    if v_n >= v_limit then
      perform set_config('hive.purging', '', true);
      return false;
    end if;
    v_left := v_left - v_n * v_cost;
  end loop;

  -- Every table is empty for this hive. Its row is gone before anything left
  -- under it is reached (a row put there since, or one left across two
  -- hives), so the freeze lets that go too.
  delete from public.hives where id = p_hive;
  update public.deleted_hives set purged_at = now() where hive_id = p_hive;
  perform set_config('hive.purging', '', true);
  return true;
end
$$;
