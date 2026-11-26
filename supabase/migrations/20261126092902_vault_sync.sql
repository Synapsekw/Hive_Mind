-- Hive Mind: vault sync. A scheduled job on a person's computer keeps one workspace equal to one
-- vault folder. It signs in with a sync key: the key is backed by an agent row, so every wall
-- an agent meets holds for it too, and it carries a sync_key_id claim. Its extra powers (moving
-- and deleting the notes and files it keeps, adopting imported notes, written dates) exist only
-- inside the sync_* functions below, which check the key is live. Restrictive policies keep it
-- off every table; only storage uploads under its own workspace go through directly.
-- Spec: docs/superpowers/specs/2026-11-26-vault-sync-design.md.

-- ------------------------------------------------------------------ tables

create table public.sync_keys (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members on delete cascade,
  workspace_id uuid not null references public.workspaces on delete cascade,
  agent_id uuid not null unique references public.agents on delete cascade,
  key_hash text not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create unique index sync_keys_one_live on public.sync_keys (member_id, workspace_id)
  where revoked_at is null;
create index sync_keys_member_idx on public.sync_keys (member_id, created_at desc);

create table public.sync_runs (
  id uuid primary key default gen_random_uuid(),
  key_id uuid not null references public.sync_keys on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  added integer not null default 0,
  changed integer not null default 0,
  moved integer not null default 0,
  deleted integer not null default 0,
  skipped integer not null default 0,
  too_big integer not null default 0,
  too_big_paths text[] not null default '{}',
  refused_deletes text[] not null default '{}',
  -- The refused list of the run before, when the job was told to let it through.
  confirmable text[] not null default '{}',
  error text
);
create index sync_runs_key_idx on public.sync_runs (key_id, started_at desc);

-- One run's manifest, page by page. Nobody reads it through the API.
create table public.sync_manifest (
  run_id uuid not null references public.sync_runs on delete cascade,
  path text not null,
  sha256 text not null,
  size bigint not null,
  home text,
  primary key (run_id, path)
);

-- Stored objects no row uses any more, removed daily by purge-hives with the secret key.
create table public.sync_orphans (
  storage_path text primary key,
  hive_id uuid not null references public.hives on delete cascade,
  at timestamptz not null default now()
);

-- No action on delete: a key goes only with its workspace, member or hive, and their notes and
-- files go in the same statement or before it (purge_hive).
alter table public.notes
  add column synced_by uuid references public.sync_keys,
  add column sync_sha256 text,
  add column sync_generated boolean not null default false;
alter table public.files
  add column vault_path text,
  add column synced_by uuid references public.sync_keys,
  add column sync_sha256 text;
create unique index files_vault_path_idx on public.files (workspace_id, vault_path)
  where vault_path is not null;
create index notes_synced_by_idx on public.notes (synced_by) where synced_by is not null;
create index files_synced_by_idx on public.files (synced_by) where synced_by is not null;

alter table public.sync_keys enable row level security;
alter table public.sync_runs enable row level security;
alter table public.sync_manifest enable row level security;
alter table public.sync_orphans enable row level security;

-- The key's hash is never read through the API.
revoke all on public.sync_keys from anon, authenticated;
grant select (id, member_id, workspace_id, agent_id, created_at, last_used_at, revoked_at)
  on public.sync_keys to authenticated;
revoke all on public.sync_runs, public.sync_manifest, public.sync_orphans
  from anon, authenticated;
grant select on public.sync_runs to authenticated;

create policy sync_keys_select on public.sync_keys for select to authenticated
  using (member_id in (select public.my_member_ids()) and public.jwt_agent_id() is null);
create policy sync_runs_select on public.sync_runs for select to authenticated
  using (public.jwt_agent_id() is null and key_id in (
    select k.id from public.sync_keys k where k.member_id in (select public.my_member_ids())));

-- ------------------------------------------------------------- the identity

-- The token says it is the sync's, whether or not its key is still live.
create function public.jwt_has_sync_claim() returns boolean
language sql stable set search_path = '' as $$
  select coalesce(auth.jwt() ? 'sync_key_id', false)
$$;

-- The live key this token was signed for, or null: the key's agent, workspace and member must
-- be the token's own.
create function public.jwt_sync_key() returns uuid
language sql stable security definer set search_path = '' as $$
  select k.id from public.sync_keys k
    join public.members m on m.id = k.member_id
   where public.jwt_has_sync_claim()
     and k.id::text = auth.jwt() ->> 'sync_key_id'
     and k.revoked_at is null
     and k.agent_id = public.jwt_agent_id()
     and k.workspace_id::text = auth.jwt() ->> 'workspace_id'
     and m.user_id = (select auth.uid())
$$;

-- Every key, live or revoked, of the same member and workspace: what one of them synced, the
-- next one keeps.
create function public._sync_family(p_key uuid) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select o.id from public.sync_keys k
    join public.sync_keys o on o.member_id = k.member_id and o.workspace_id = k.workspace_id
   where k.id = p_key
$$;

create function public._sync_live() returns public.sync_keys
language plpgsql stable security definer set search_path = '' as $$
declare
  k public.sync_keys;
begin
  select * into k from public.sync_keys where id = public.jwt_sync_key();
  if k.id is null then
    raise exception 'this sync key is not live' using errcode = '42501';
  end if;
  return k;
end
$$;

-- -------------------------------------------------------------------- keys

create function public.create_sync_key(p_workspace uuid)
returns table (key_id uuid, key text)
language plpgsql security definer set search_path = '' as $$
declare
  v_member uuid;
  v_key text := 'hsync_' || replace(gen_random_uuid()::text, '-', '')
                         || replace(gen_random_uuid()::text, '-', '');
  v_agent uuid;
  v_id uuid;
begin
  if (select auth.uid()) is null or public.jwt_agent_id() is not null
     or public.jwt_oauth_client() is not null or public.jwt_is_self_hosted()
     or public.jwt_has_sync_claim() then
    raise exception 'only a person makes a sync key' using errcode = '42501';
  end if;
  select w.member_id into v_member from public.workspaces w
   where w.id = p_workspace and w.member_id in (select public.my_member_ids());
  if v_member is null then
    raise exception 'that workspace is not yours' using errcode = '42501';
  end if;
  update public.agents a set revoked_at = now()
    from public.sync_keys k
   where k.agent_id = a.id and k.member_id = v_member and k.workspace_id = p_workspace
     and k.revoked_at is null;
  update public.sync_keys set revoked_at = now()
   where member_id = v_member and workspace_id = p_workspace and revoked_at is null;
  -- The agent's own token is a value nobody is ever given: agent_login cannot match it.
  insert into public.agents (member_id, workspace_id, name, provider, trust_tier, token_hash)
  values (v_member, p_workspace, 'Hive sync', 'hive-sync', 'vendor',
          encode(sha256(convert_to('unusable:' || gen_random_uuid()::text
                                   || gen_random_uuid()::text, 'UTF8')), 'hex'))
  returning id into v_agent;
  insert into public.sync_keys (member_id, workspace_id, agent_id, key_hash)
  values (v_member, p_workspace, v_agent, encode(sha256(convert_to(v_key, 'UTF8')), 'hex'))
  returning id into v_id;
  return query select v_id, v_key;
end
$$;

create function public.revoke_sync_key(p_key uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  k public.sync_keys;
begin
  if (select auth.uid()) is null or public.jwt_agent_id() is not null
     or public.jwt_oauth_client() is not null or public.jwt_has_sync_claim() then
    raise exception 'only a person revokes a sync key' using errcode = '42501';
  end if;
  select * into k from public.sync_keys
   where id = p_key and member_id in (select public.my_member_ids());
  if k.id is null then
    raise exception 'that sync key is not yours' using errcode = '42501';
  end if;
  update public.sync_keys set revoked_at = coalesce(revoked_at, now()) where id = k.id;
  update public.agents set revoked_at = coalesce(revoked_at, now()) where id = k.agent_id;
end
$$;

-- sync-session exchanges a key for the identity to sign. Default error code (P0001): the REST
-- API answers 400, which the function reads as "refused".
create function public.sync_login(p_key text)
returns table (sync_key_id uuid, agent_id uuid, user_id uuid, member_id uuid,
               workspace_id uuid, hive_id uuid, trust_tier public.trust_tier)
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if p_key is null or p_key !~ '^hsync_[0-9a-f]{64}$' then
    raise exception 'unknown or revoked sync key';
  end if;
  select k.id into v_id from public.sync_keys k join public.agents a on a.id = k.agent_id
   where k.key_hash = encode(sha256(convert_to(p_key, 'UTF8')), 'hex')
     and k.revoked_at is null and a.revoked_at is null;
  if v_id is null then
    raise exception 'unknown or revoked sync key';
  end if;
  update public.sync_keys set last_used_at = now() where id = v_id;
  return query
    select k.id, k.agent_id, m.user_id, m.id, k.workspace_id, m.hive_id, a.trust_tier
      from public.sync_keys k
      join public.members m on m.id = k.member_id
      join public.agents a on a.id = k.agent_id
     where k.id = v_id;
end
$$;

-- --------------------------------------------------------------- triggers

create or replace function public.notes_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  w public.workspaces;
  agent uuid := public.jwt_agent_id();
  -- sync: the live key of a sync identity, else null.
  sync_key uuid := public.jwt_sync_key();
  k public.sync_keys;
  -- An agent or an app: its dates are the real moment. sync: the sync is not limited; it
  -- sends the file's dates, as an import does.
  limited boolean := (public.jwt_agent_id() is not null and sync_key is null)
                  or public.jwt_oauth_client() is not null
                  or public.jwt_is_self_hosted();
  person boolean;
  earliest constant timestamptz := timestamptz '1990-01-01 00:00:00+00';
begin
  -- A signed-in person: may set the two dates, within the rules below.
  person := not limited and (select auth.uid()) is not null;
  if sync_key is not null then
    select * into k from public.sync_keys where id = sync_key;
  end if;

  if tg_op = 'INSERT' then
    select * into w from public.workspaces where id = new.workspace_id;
    if not found or w.member_id <> new.member_id then
      raise exception 'workspace does not belong to this member';
    end if;
    new.hive_id := w.hive_id;
    new.version := 1;
    new.written_by_agent := agent;
    -- sync: what the sync writes is kept by its key; nobody else marks a note so.
    if sync_key is not null then
      if new.member_id <> k.member_id or new.workspace_id <> k.workspace_id then
        raise exception 'the sync writes only in its own workspace';
      end if;
      new.synced_by := sync_key;
    else
      new.synced_by := null;
      new.sync_sha256 := null;
      new.sync_generated := false;
    end if;
    if agent is not null then
      if new.visibility is not null or new.shared_with <> '{}' then
        raise exception 'agents cannot set sharing';
      end if;
      new.quarantined := public.jwt_is_self_hosted();
    end if;
    -- created_at and updated_at: an agent, an app or a self-hosted claim gets now. A person's
    -- are held between 1990-01-01 and now, updated_at never before created_at. The server with
    -- no caller is not checked.
    if limited then
      new.created_at := now();
      new.updated_at := now();
    elsif person then
      new.created_at := greatest(
        least(coalesce(new.created_at, now()), now()), earliest);
      new.updated_at := least(
        greatest(coalesce(new.updated_at, now()), new.created_at), now());
    end if;
    return new;
  end if;

  if new.member_id <> old.member_id or new.workspace_id <> old.workspace_id
     or new.hive_id <> old.hive_id then
    raise exception 'a note cannot move to another member, workspace or hive';
  end if;
  -- sync: the sync changes only the notes its key's family keeps, or adopts a note of its own
  -- member and workspace that nobody keeps yet.
  if sync_key is not null then
    -- Every arm is a real boolean (a null IN is null, and an IF on null does not raise).
    if not coalesce(
         ((old.synced_by is not null
           and old.synced_by in (select public._sync_family(sync_key)))
          or (old.synced_by is null and new.synced_by is not distinct from sync_key))
         and old.member_id = k.member_id and old.workspace_id = k.workspace_id
         and new.synced_by is not null
         and new.synced_by in (select public._sync_family(sync_key)), false) then
      raise exception 'the sync only changes the notes it keeps';
    end if;
  elsif (select auth.uid()) is not null then
    -- sync: a signed-in caller that is not the sync. The service (no caller) is not held.
    if new.synced_by is distinct from old.synced_by
       or new.sync_sha256 is distinct from old.sync_sha256
       or new.sync_generated <> old.sync_generated then
      raise exception 'only the sync marks a note as kept by your vault';
    end if;
    if old.synced_by is not null and (
         new.title <> old.title or new.body <> old.body
      or new.frontmatter <> old.frontmatter or new.path <> old.path
      or new.folder_id is distinct from old.folder_id) then
      raise exception 'this note is kept by your vault: edit it in your vault';
    end if;
  end if;
  if agent is not null and sync_key is null and new.path <> old.path then
    raise exception 'agents cannot move a note';
  end if;
  if agent is not null and (
       new.visibility is distinct from old.visibility
    or new.shared_with <> old.shared_with
    or new.quarantined <> old.quarantined
    or (sync_key is null and new.folder_id is distinct from old.folder_id)) then
    raise exception 'agents cannot change sharing';
  end if;
  -- Null keeps the old created_at; a value that was sent is held between the floor and now
  -- (greatest and least skip a null, so null is handled first).
  if limited then
    new.created_at := old.created_at;
  elsif person and new.created_at is distinct from old.created_at then
    if new.created_at is null then
      new.created_at := old.created_at;
    else
      new.created_at := greatest(least(new.created_at, now()), earliest);
    end if;
  end if;
  -- A change of content stamps updated_at as now, except that a person (an import) may send
  -- the date of the change with it; the version goes up and written_by_agent is set either way.
  if new.title <> old.title or new.body <> old.body or new.frontmatter <> old.frontmatter then
    new.version := old.version + 1;
    if person and new.updated_at is distinct from old.updated_at then
      new.updated_at := least(
        greatest(coalesce(new.updated_at, now()), new.created_at, earliest),
        now());
    else
      new.updated_at := now();
    end if;
    new.written_by_agent := agent;
  else
    new.version := old.version;
    if limited then
      new.updated_at := old.updated_at;
    elsif person and (new.updated_at is distinct from old.updated_at
                      or new.created_at is distinct from old.created_at) then
      if new.updated_at is null then
        new.updated_at := old.updated_at;
      elsif new.updated_at is distinct from old.updated_at then
        new.updated_at := greatest(new.updated_at, earliest);
      end if;
      new.updated_at := least(greatest(new.updated_at, new.created_at), now());
    end if;
  end if;
  return new;
end
$$;

-- The three sync columns of a file are the sync's alone. A person's or an agent's insert has
-- them emptied; an update by any other signed-in caller that changes them is refused.
create function public.files_sync_columns() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  sync_key uuid := public.jwt_sync_key();
  k public.sync_keys;
begin
  if sync_key is not null then
    select * into k from public.sync_keys where id = sync_key;
    if tg_op = 'INSERT' then
      if new.member_id <> k.member_id or new.workspace_id <> k.workspace_id then
        raise exception 'the sync writes only in its own workspace';
      end if;
      new.synced_by := sync_key;
    elsif not coalesce(
         old.synced_by is not null
         and old.synced_by in (select public._sync_family(sync_key))
         and old.member_id = k.member_id and old.workspace_id = k.workspace_id
         and new.member_id = old.member_id and new.workspace_id = old.workspace_id
         and new.synced_by is not null
         and new.synced_by in (select public._sync_family(sync_key)), false) then
      raise exception 'the sync only changes the files it keeps';
    end if;
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.vault_path := null;
    new.synced_by := null;
    new.sync_sha256 := null;
  elsif (select auth.uid()) is not null and (
       new.vault_path is distinct from old.vault_path
    or new.synced_by is distinct from old.synced_by
    or new.sync_sha256 is distinct from old.sync_sha256) then
    raise exception 'only the sync changes where a vault file is kept';
  end if;
  return new;
end
$$;
create trigger files_sync_columns before insert or update on public.files
  for each row execute function public.files_sync_columns();
revoke all on function public.files_sync_columns() from public, anon, authenticated;

create or replace function public.tag_session() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_closing text := current_setting('hive.closing_session', true);
begin
  if v_closing is not null and v_closing <> '' then
    new.session_id := v_closing::uuid;
    return new;
  end if;
  -- sync: what the sync writes belongs to no session.
  if public.jwt_has_sync_claim() then
    if tg_op = 'INSERT' then
      new.session_id := null;
    else
      new.session_id := case
        when new.session_id is null and old.session_id is not null
             and not exists (select 1 from public.sessions s where s.id = old.session_id)
        then null
        else old.session_id
      end;
    end if;
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

-- ------------------------------------------------------------- the walls

-- Restrictive, so no other policy can let the sync identity through: on every table of the
-- public schema with row-level security, the four sync tables included. It reaches the tables
-- only through the sync_* functions. A table added later needs its own *_no_sync policy.
do $$
declare
  t record;
begin
  for t in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
  loop
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated '
      'using (not public.jwt_has_sync_claim()) with check (not public.jwt_has_sync_claim())',
      t.relname || '_no_sync', t.relname);
  end loop;
end
$$;

-- An app pass sees no sync rows either.
create policy sync_keys_no_app on public.sync_keys as restrictive for all to authenticated
  using (public.jwt_oauth_client() is null) with check (public.jwt_oauth_client() is null);
create policy sync_runs_no_app on public.sync_runs as restrictive for all to authenticated
  using (public.jwt_oauth_client() is null) with check (public.jwt_oauth_client() is null);

-- ------------------------------------------------------------------ grants

revoke all on function public.jwt_sync_key() from public, anon;
revoke all on function public._sync_family(uuid) from public, anon, authenticated;
revoke all on function public._sync_live() from public, anon, authenticated;
revoke all on function public.create_sync_key(uuid) from public, anon;
revoke all on function public.revoke_sync_key(uuid) from public, anon;
revoke all on function public.sync_login(text) from public;
grant execute on function public.jwt_has_sync_claim() to authenticated;
grant execute on function public.jwt_sync_key() to authenticated;
grant execute on function public.create_sync_key(uuid) to authenticated;
grant execute on function public.revoke_sync_key(uuid) to authenticated;
grant execute on function public.sync_login(text) to anon, authenticated;

-- ------------------------------------------------------------------- runs

-- The caller's open run. Raises for any other id.
create function public._sync_run(p_run uuid) returns public.sync_runs
language plpgsql stable security definer set search_path = '' as $$
declare
  k public.sync_keys := public._sync_live();
  r public.sync_runs;
begin
  select * into r from public.sync_runs
   where id = p_run and key_id = k.id and finished_at is null;
  if r.id is null then
    raise exception 'no such run' using errcode = '22023';
  end if;
  return r;
end
$$;

create function public.sync_open_run(p_confirm boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  k public.sync_keys := public._sync_live();
  v_prev text[];
  v_run uuid;
begin
  if coalesce(p_confirm, false) then
    select r.refused_deletes into v_prev from public.sync_runs r
     where r.key_id in (select public._sync_family(k.id))
     order by r.started_at desc limit 1;
  end if;
  insert into public.sync_runs (key_id, confirmable)
  values (k.id, coalesce(v_prev, '{}'))
  returning id into v_run;
  return jsonb_build_object(
    'run_id', v_run,
    'storage_prefix', k.member_id::text || '/' || k.workspace_id::text || '/vault/');
end
$$;

-- A vault path the sync may name: relative, "/" separated, no empty, "." or ".." part, no
-- backslash, 1 to 4000 characters.
create function public._sync_path_ok(p text) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(
    length(p) between 1 and 4000
    and p !~ '(^|/)\.{1,2}(/|$)' and p !~ '//' and p !~ '^/' and p !~ '/$'
    and position(E'\\' in p) = 0, false)
$$;

-- ------------------------------------------------------------------- plan

create function public.sync_plan(p_run uuid, p_entries jsonb, p_last boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  k public.sync_keys := public._sync_live();
  r public.sync_runs := public._sync_run(p_run);
  v_n integer;
  v_out jsonb;
begin
  if coalesce(jsonb_typeof(p_entries), '') <> 'array' then
    raise exception 'a manifest entry is not usable' using errcode = '22023';
  end if;
  v_n := jsonb_array_length(p_entries);
  if v_n > 2000 then
    raise exception 'a page holds at most 2000 entries' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_entries) e
     where coalesce(jsonb_typeof(e), '') <> 'object'
        or not public._sync_path_ok(e ->> 'path')
        or coalesce(e ->> 'sha256', '') !~ '^[0-9a-f]{64}$'
        or coalesce(jsonb_typeof(e -> 'size'), '') <> 'number'
        or not coalesce((e ->> 'size')::numeric between 0 and 52428800, false)
        or (e ? 'home'
            and (jsonb_typeof(e -> 'home') not in ('string', 'null')
                 or (jsonb_typeof(e -> 'home') = 'string'
                     and not public._sync_path_ok(e ->> 'home'))))) then
    raise exception 'a manifest entry is not usable' using errcode = '22023';
  end if;
  insert into public.sync_manifest (run_id, path, sha256, size, home)
  select p_run, e ->> 'path', e ->> 'sha256', (e ->> 'size')::bigint, e ->> 'home'
    from jsonb_array_elements(p_entries) e
  on conflict (run_id, path) do update
    set sha256 = excluded.sha256, size = excluded.size, home = excluded.home;
  if not coalesce(p_last, false) then
    return jsonb_build_object('received', v_n);
  end if;

  -- Adoption: a note of the key's member and workspace at a manifest path, kept by nobody.
  -- It has no fingerprint yet, so it is planned as changed and its text is sent once.
  update public.notes n set synced_by = k.id, sync_sha256 = null
    from public.sync_manifest m
   where m.run_id = p_run and m.path ~* '\.md$'
     and n.workspace_id = k.workspace_id and n.member_id = k.member_id
     and n.path = m.path and n.synced_by is null;

  with fam as (select f as id from public._sync_family(k.id) f),
  m as (select path, sha256, home, (path ~* '\.md$') as note
          from public.sync_manifest where run_id = p_run),
  kept as (
    select n.path, n.sync_sha256 as sha, true as note, null::text as home
      from public.notes n
     where n.workspace_id = k.workspace_id and n.synced_by in (select id from fam)
       and not n.sync_generated
    union all
    select f.vault_path, f.sync_sha256, false,
           (select x.path from public.notes x where x.id = f.note_id)
      from public.files f
     where f.workspace_id = k.workspace_id and f.vault_path is not null
       and f.synced_by in (select id from fam)),
  fresh as (select m.* from m where not exists (
              select 1 from kept where kept.path = m.path and kept.note = m.note)),
  lost as (select kept.* from kept where not exists (
              select 1 from m where m.path = kept.path and m.note = kept.note)),
  pairs as (
    select l.path as from_path, f.path as to_path
      from lost l join fresh f on f.sha256 = l.sha and f.note = l.note
     where (select count(*) from fresh f2 where f2.sha256 = l.sha and f2.note = l.note) = 1
       and (select count(*) from lost l2 where l2.sha = l.sha and l2.note = l.note) = 1)
  select jsonb_build_object(
    'new', coalesce((select jsonb_agg(path order by path) from fresh
                      where not exists (select 1 from pairs where pairs.to_path = fresh.path)),
      '[]'),
    'changed', coalesce((select jsonb_agg(m.path order by m.path)
                           from m join kept on kept.path = m.path and kept.note = m.note
                          where kept.sha is distinct from m.sha256), '[]'),
    'moved', coalesce((select jsonb_agg(jsonb_build_object('from', from_path, 'to', to_path)
                                        order by to_path) from pairs), '[]'),
    'gone', coalesce((select jsonb_agg(path order by path) from lost
                       where not exists (select 1 from pairs where pairs.from_path = lost.path)),
      '[]'),
    'rehome', coalesce((select jsonb_agg(jsonb_build_object('path', m.path, 'home', m.home)
                                         order by m.path)
                          from m join kept on kept.path = m.path and not kept.note
                         where not m.note and kept.sha = m.sha256
                           and m.home is not null and m.home is distinct from kept.home), '[]'),
    'kept', (select count(*) from kept))
  into v_out;
  return v_out;
end
$$;

-- ------------------------------------------------------------------ notes

-- The folder row of a vault path's folder, made when missing; null at the top.
create function public._sync_folder(k public.sync_keys, p_path text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_dir text := case when strpos(p_path, '/') > 0
                     then regexp_replace(p_path, '/[^/]*$', '') end;
  v_id uuid;
begin
  if v_dir is null then return null; end if;
  insert into public.folders (workspace_id, member_id, path)
  values (k.workspace_id, k.member_id, v_dir)
  on conflict (workspace_id, path) do nothing;
  select id into v_id from public.folders where workspace_id = k.workspace_id and path = v_dir;
  return v_id;
end
$$;

-- A date the job sent: an ISO text of at most 40 characters, else null.
create function public._sync_date(p text) returns timestamptz
language plpgsql stable set search_path = '' as $$
begin
  if p is null or length(p) > 40 then return null; end if;
  return p::timestamptz;
exception when others then
  return null;
end
$$;

create function public.sync_put_notes(p_run uuid, p_notes jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  k public.sync_keys := public._sync_live();
  r public.sync_runs := public._sync_run(p_run);
  e jsonb;
  n public.notes;
  v_path text;
  v_from text;
  v_folder uuid;
  v_id uuid;
  v_written jsonb := '[]';
  v_failed jsonb := '[]';
begin
  if coalesce(jsonb_typeof(p_notes), '') <> 'array' then
    raise exception 'a note is not usable' using errcode = '22023';
  end if;
  if jsonb_array_length(p_notes) > 50 then
    raise exception 'a batch holds at most 50 notes' using errcode = '22023';
  end if;
  if (select coalesce(sum(octet_length(coalesce(x ->> 'title', ''))
                          + octet_length(coalesce(x ->> 'body', ''))
                          + octet_length(coalesce((x -> 'frontmatter')::text, ''))), 0)
        from jsonb_array_elements(p_notes) x) > 1000000 then
    raise exception 'a batch holds at most 1 MB of text' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_notes) x
     where coalesce(jsonb_typeof(x), '') <> 'object'
        or not public._sync_path_ok(x ->> 'path') or (x ->> 'path') !~* '\.md$'
        or (x ? 'from' and (jsonb_typeof(x -> 'from') <> 'string'
                            or not public._sync_path_ok(x ->> 'from')))
        or coalesce(jsonb_typeof(x -> 'title'), '') <> 'string'
        or not coalesce(length(x ->> 'title') between 1 and 1000, false)
        or coalesce(jsonb_typeof(x -> 'body'), '') <> 'string'
        or coalesce(jsonb_typeof(x -> 'frontmatter'), '') <> 'object'
        or coalesce(x ->> 'sha256', '') !~ '^[0-9a-f]{64}$') then
    raise exception 'a note is not usable' using errcode = '22023';
  end if;

  for e in select * from jsonb_array_elements(p_notes) loop
    v_path := e ->> 'path';
    v_from := e ->> 'from';
    begin
      v_folder := public._sync_folder(k, v_path);
      n := null;
      if v_from is not null then
        select * into n from public.notes x
         where x.workspace_id = k.workspace_id and x.path = v_from
           and x.synced_by in (select public._sync_family(k.id));
      end if;
      if n.id is null then
        v_from := null;
        select * into n from public.notes x
         where x.workspace_id = k.workspace_id and x.member_id = k.member_id
           and x.path = v_path
           and (x.synced_by is null or x.synced_by in (select public._sync_family(k.id)));
      end if;
      if n.id is null then
        insert into public.notes (hive_id, member_id, workspace_id, path, title, body,
                                  frontmatter, folder_id, sync_sha256, created_at, updated_at)
        values ((select w.hive_id from public.workspaces w where w.id = k.workspace_id),
                k.member_id, k.workspace_id, v_path, e ->> 'title', e ->> 'body',
                e -> 'frontmatter', v_folder, e ->> 'sha256',
                public._sync_date(e ->> 'created_at'),
                coalesce(public._sync_date(e ->> 'updated_at'),
                         public._sync_date(e ->> 'created_at')))
        returning id into v_id;
      else
        update public.notes set
          path = v_path, folder_id = v_folder,
          title = e ->> 'title', body = e ->> 'body', frontmatter = e -> 'frontmatter',
          synced_by = k.id, sync_sha256 = e ->> 'sha256',
          created_at = coalesce(public._sync_date(e ->> 'created_at'), n.created_at),
          updated_at = coalesce(public._sync_date(e ->> 'updated_at'), n.updated_at)
         where id = n.id
        returning id into v_id;
        if v_from is not null and v_from <> v_path then
          insert into public.audit_log (hive_id, member_id, agent_id, action, note_id, detail)
          values (n.hive_id, k.member_id, k.agent_id, 'note.moved', n.id,
                  jsonb_build_object('from', v_from, 'to', v_path, 'sync_key_id', k.id));
        end if;
      end if;
      v_written := v_written || jsonb_build_array(jsonb_build_object('path', v_path, 'id', v_id));
    exception when others then
      v_failed := v_failed || jsonb_build_array(jsonb_build_object('path', v_path, 'code', sqlstate));
    end;
  end loop;
  return jsonb_build_object('written', v_written, 'failed', v_failed);
end
$$;

-- ------------------------------------------------------------------ links

create function public.sync_link_notes(p_run uuid, p_pairs jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  k public.sync_keys := public._sync_live();
  r public.sync_runs := public._sync_run(p_run);
  v_n integer := 0;
  p record;
begin
  if coalesce(jsonb_typeof(p_pairs), '') <> 'array' or jsonb_array_length(p_pairs) > 2000 then
    raise exception 'a batch holds at most 2000 links' using errcode = '22023';
  end if;
  for p in
    select distinct on (least(a.id, b.id), greatest(a.id, b.id)) a.id as a_id, b.id as b_id
      from jsonb_array_elements(p_pairs) e
      join public.notes a on a.workspace_id = k.workspace_id and a.path = e ->> 'from'
                         and a.synced_by in (select public._sync_family(k.id))
      join public.notes b on b.workspace_id = k.workspace_id and b.member_id = k.member_id
                         and b.path = e ->> 'to'
     where a.id <> b.id
       and not exists (select 1 from public.links l
                        where least(l.from_note, l.to_note) = least(a.id, b.id)
                          and greatest(l.from_note, l.to_note) = greatest(a.id, b.id))
  loop
    begin
      -- links_before_insert accepts a link between two notes of one owner at once.
      insert into public.links (hive_id, from_note, to_note, tier, score)
      values ((select hive_id from public.notes where id = p.a_id), p.a_id, p.b_id, 2, 0.8);
      v_n := v_n + 1;
    exception when unique_violation or raise_exception then
      null;  -- a pair another run linked meanwhile
    end;
  end loop;
  return v_n;
end
$$;

revoke all on function public._sync_run(uuid) from public, anon, authenticated;
revoke all on function public._sync_path_ok(text) from public, anon;
revoke all on function public._sync_folder(public.sync_keys, text) from public, anon, authenticated;
revoke all on function public._sync_date(text) from public, anon;
revoke all on function public.sync_open_run(boolean) from public, anon;
revoke all on function public.sync_plan(uuid, jsonb, boolean) from public, anon;
revoke all on function public.sync_put_notes(uuid, jsonb) from public, anon;
revoke all on function public.sync_link_notes(uuid, jsonb) from public, anon;
grant execute on function public.sync_open_run(boolean) to authenticated;
grant execute on function public.sync_plan(uuid, jsonb, boolean) to authenticated;
grant execute on function public.sync_put_notes(uuid, jsonb) to authenticated;
grant execute on function public.sync_link_notes(uuid, jsonb) to authenticated;

-- ------------------------------------------------------------------ files

-- An object path no row uses any more, queued for purge-hives.
create function public._sync_orphan(p_path text, p_hive uuid) returns void
language sql security definer set search_path = '' as $$
  insert into public.sync_orphans (storage_path, hive_id)
  select p_path, p_hive
   where p_path is not null
     and not exists (select 1 from public.files f where f.storage_path = p_path)
  on conflict (storage_path) do nothing
$$;

-- The note a file lives in, by path. A missing "Vault files" note of a folder is made, kept by
-- the sync (notes_before_write marks it) and marked as generated; any other missing note is a
-- failure for that file.
create function public._sync_home(k public.sync_keys, p_home text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  select id into v_id from public.notes
   where workspace_id = k.workspace_id and member_id = k.member_id and path = p_home;
  if v_id is not null then return v_id; end if;
  if p_home !~ '(^|/)Vault files\.md$' then
    raise exception 'no such home note' using errcode = 'P0002';
  end if;
  insert into public.notes (hive_id, member_id, workspace_id, path, title, body, folder_id,
                            sync_generated)
  values ((select w.hive_id from public.workspaces w where w.id = k.workspace_id),
          k.member_id, k.workspace_id, p_home, 'Vault files',
          'Files in this folder of your vault that no note links to.',
          public._sync_folder(k, p_home), true)
  returning id into v_id;
  return v_id;
end
$$;

create function public.sync_put_files(p_run uuid, p_files jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  k public.sync_keys := public._sync_live();
  r public.sync_runs := public._sync_run(p_run);
  v_prefix text := k.member_id::text || '/' || k.workspace_id::text || '/vault/';
  e jsonb;
  f public.files;
  v_path text;
  v_from text;
  v_store text;
  v_mime text;
  v_home uuid;
  v_id uuid;
  v_written jsonb := '[]';
  v_failed jsonb := '[]';
begin
  if coalesce(jsonb_typeof(p_files), '') <> 'array' or jsonb_array_length(p_files) > 200 then
    raise exception 'a batch holds at most 200 files' using errcode = '22023';
  end if;
  -- Every field has its JSON type checked first: a number or a null is not a text.
  if exists (
    select 1 from jsonb_array_elements(p_files) x
     where coalesce(jsonb_typeof(x), '') <> 'object'
        or coalesce(jsonb_typeof(x -> 'path'), '') <> 'string'
        or not public._sync_path_ok(x ->> 'path') or (x ->> 'path') ~* '\.md$'
        or (x ? 'from' and (jsonb_typeof(x -> 'from') <> 'string'
                            or not public._sync_path_ok(x ->> 'from')))
        or coalesce(jsonb_typeof(x -> 'home'), '') <> 'string'
        or not public._sync_path_ok(x ->> 'home') or (x ->> 'home') !~* '\.md$'
        or coalesce(jsonb_typeof(x -> 'name'), '') <> 'string'
        or not coalesce(length(x ->> 'name') between 1 and 255, false)
        or position('/' in x ->> 'name') > 0
        or coalesce(jsonb_typeof(x -> 'size'), '') <> 'number'
        or not coalesce(case when jsonb_typeof(x -> 'size') = 'number'
                             then (x ->> 'size')::numeric between 0 and 52428800 end, false)
        or coalesce(jsonb_typeof(x -> 'sha256'), '') <> 'string'
        or coalesce(x ->> 'sha256', '') !~ '^[0-9a-f]{64}$'
        or coalesce(jsonb_typeof(x -> 'mime'), '') <> 'string'
        or not coalesce(length(x ->> 'mime') between 1 and 100, false)
        or (x ? 'storage_path'
            and (jsonb_typeof(x -> 'storage_path') <> 'string'
                 or left(x ->> 'storage_path', length(v_prefix)) <> v_prefix
                 or substr(x ->> 'storage_path', length(v_prefix) + 1)
                    !~ '^[0-9a-f]{32}/[^/]{1,255}$'))) then
    raise exception 'a file is not usable' using errcode = '22023';
  end if;

  for e in select * from jsonb_array_elements(p_files) loop
    v_path := e ->> 'path';
    v_from := e ->> 'from';
    v_store := e ->> 'storage_path';
    -- A type a browser would render as a page is never declared (gallery v2).
    v_mime := case when lower(e ->> 'mime') in ('text/html', 'image/svg+xml',
                         'application/xhtml+xml', 'text/xml', 'application/xml')
                   then 'application/octet-stream' else e ->> 'mime' end;
    begin
      f := null;
      if v_store is not null and not exists (
           select 1 from storage.objects o where o.bucket_id = 'files' and o.name = v_store) then
        raise exception 'the file was not stored' using errcode = 'P0002';
      end if;
      v_home := public._sync_home(k, e ->> 'home');
      if v_from is not null then
        select * into f from public.files x
         where x.workspace_id = k.workspace_id and x.vault_path = v_from
           and x.synced_by in (select public._sync_family(k.id));
      end if;
      if f.id is null then
        v_from := null;
        select * into f from public.files x
         where x.workspace_id = k.workspace_id and x.vault_path = v_path
           and x.synced_by in (select public._sync_family(k.id));
      end if;
      if f.id is null then
        if v_store is null then
          raise exception 'the file was not stored' using errcode = 'P0002';
        end if;
        insert into public.files (hive_id, member_id, workspace_id, note_id, storage_path,
                                  name, mime, size_bytes, vault_path, sync_sha256)
        values ((select w.hive_id from public.workspaces w where w.id = k.workspace_id),
                k.member_id, k.workspace_id, v_home, v_store, e ->> 'name', v_mime,
                (e ->> 'size')::bigint, v_path, e ->> 'sha256')
        returning id into v_id;
      else
        -- hive_id, member_id and workspace_id are never set here.
        update public.files set
          note_id = v_home, vault_path = v_path, synced_by = k.id,
          storage_path = coalesce(v_store, f.storage_path),
          name = case when v_store is null then f.name else e ->> 'name' end,
          mime = case when v_store is null then f.mime else v_mime end,
          -- files_set_kind fires on insert only, so a change sets the kind itself.
          kind = case when v_store is null then f.kind
                      else public.file_kind(e ->> 'name', v_mime) end,
          size_bytes = case when v_store is null then f.size_bytes
                            else (e ->> 'size')::bigint end,
          sync_sha256 = case when v_store is null then f.sync_sha256 else e ->> 'sha256' end
         where id = f.id
        returning id into v_id;
        if v_store is not null and v_store <> f.storage_path then
          perform public._sync_orphan(f.storage_path, f.hive_id);
        end if;
        if v_from is not null and v_from <> v_path then
          insert into public.audit_log (hive_id, member_id, agent_id, action, detail)
          values (f.hive_id, k.member_id, k.agent_id, 'file.moved',
                  jsonb_build_object('file_id', f.id, 'from', v_from, 'to', v_path,
                                     'sync_key_id', k.id));
        end if;
      end if;
      if v_store is not null then
        delete from public.sync_orphans where storage_path = v_store;
      end if;
      v_written := v_written || jsonb_build_array(jsonb_build_object('path', v_path, 'id', v_id));
    exception when others then
      v_failed := v_failed || jsonb_build_array(jsonb_build_object('path', v_path, 'code', sqlstate));
    end;
  end loop;
  return jsonb_build_object('written', v_written, 'failed', v_failed);
end
$$;

-- ---------------------------------------------------------------- deletes

-- Deletes the notes and files at these vault paths that the key's family keeps. A batch of
-- more than 25, or of more than 2% of what is kept (when that is more than one item), is
-- refused whole and recorded on the run. The next run lets exactly that list through when it
-- was opened with confirm.
create function public.sync_delete(p_run uuid, p_paths text[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  k public.sync_keys := public._sync_live();
  r public.sync_runs := public._sync_run(p_run);
  v_paths text[];
  v_n integer;
  v_total integer;
  f record;
begin
  if p_paths is null or cardinality(p_paths) > 20000
     or exists (select 1 from unnest(p_paths) p where not public._sync_path_ok(p)) then
    raise exception 'a path is not usable' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct p order by p), '{}') into v_paths
    from unnest(p_paths) p
   where exists (select 1 from public.notes n
                  where n.workspace_id = k.workspace_id and n.path = p and not n.sync_generated
                    and n.synced_by in (select public._sync_family(k.id)))
      or exists (select 1 from public.files x
                  where x.workspace_id = k.workspace_id and x.vault_path = p
                    and x.synced_by in (select public._sync_family(k.id)));
  v_n := cardinality(v_paths);
  if v_n = 0 then
    return jsonb_build_object('deleted', 0, 'refused', 0);
  end if;
  select (select count(*) from public.notes n
           where n.workspace_id = k.workspace_id and not n.sync_generated
             and n.synced_by in (select public._sync_family(k.id)))
       + (select count(*) from public.files x
           where x.workspace_id = k.workspace_id
             and x.synced_by in (select public._sync_family(k.id)))
    into v_total;
  if (v_n > 25 or (v_n > 1 and v_n * 50 > v_total))
     and not (r.confirmable @> p_paths) then
    update public.sync_runs set refused_deletes = p_paths where id = r.id;
    return jsonb_build_object('deleted', 0, 'refused', cardinality(p_paths));
  end if;

  for f in
    delete from public.files x
     where x.workspace_id = k.workspace_id and x.vault_path = any(v_paths)
       and x.synced_by in (select public._sync_family(k.id))
    returning x.storage_path, x.hive_id
  loop
    perform public._sync_orphan(f.storage_path, f.hive_id);
  end loop;
  delete from public.notes n
   where n.workspace_id = k.workspace_id and n.path = any(v_paths) and not n.sync_generated
     and n.synced_by in (select public._sync_family(k.id));
  return jsonb_build_object('deleted', v_n, 'refused', 0);
end
$$;

-- ----------------------------------------------------------------- finish

-- A count the job sent: a whole number from 0 to 1,000,000, else 0.
create function public._sync_count(v jsonb) returns integer
language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(v) = 'number'
              then case when (v #>> '{}')::numeric between 0 and 1000000
                        then floor((v #>> '{}')::numeric)::integer else 0 end
              else 0 end
$$;

create function public.sync_finish(p_run uuid, p_counts jsonb, p_too_big text[], p_error text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  k public.sync_keys := public._sync_live();
  r public.sync_runs := public._sync_run(p_run);
  c jsonb := case when jsonb_typeof(p_counts) = 'object' then p_counts else '{}' end;
begin
  update public.sync_runs set
    finished_at = now(),
    added = public._sync_count(c -> 'added'),
    changed = public._sync_count(c -> 'changed'),
    moved = public._sync_count(c -> 'moved'),
    deleted = public._sync_count(c -> 'deleted'),
    skipped = public._sync_count(c -> 'skipped'),
    too_big = public._sync_count(c -> 'too_big'),
    too_big_paths = coalesce((select array_agg(left(p, 4000))
                                from (select unnest(p_too_big) p limit 200) x), '{}'),
    error = left(p_error, 500)
   where id = r.id;
  -- This run's manifest, and any an interrupted run of the family left behind.
  delete from public.sync_manifest m
   where m.run_id in (select x.id from public.sync_runs x
                       where x.key_id in (select public._sync_family(k.id)));
  -- A generated "Vault files" note no file lives in any more.
  delete from public.notes n
   where n.workspace_id = k.workspace_id and n.sync_generated
     and n.synced_by in (select public._sync_family(k.id))
     and not exists (select 1 from public.files f where f.note_id = n.id);
  delete from public.sync_runs x
   where x.key_id = k.id
     and x.id not in (select y.id from public.sync_runs y where y.key_id = k.id
                       order by y.started_at desc, y.id limit 200);
end
$$;

-- --------------------------------------------------------- the home note

create or replace function public.file_set_home(p_file uuid, p_note uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  f public.files;
begin
  if public.jwt_oauth_client() is not null then
    raise exception 'an app pass cannot do this';
  end if;
  if public.jwt_agent_id() is not null
     or public.jwt_is_self_hosted() or (select auth.uid()) is null then
    raise exception 'only a person changes where a file lives';
  end if;
  select * into f from public.files
   where id = p_file and member_id in (select public.my_member_ids());
  if not found then raise exception 'no such file'; end if;
  -- sync: the vault decides where a file it keeps lives.
  if f.synced_by is not null then
    raise exception 'your vault sets where this file lives';
  end if;
  if p_note is not null and not exists (
       select 1 from public.notes n where n.id = p_note and n.member_id = f.member_id) then
    raise exception 'a file can only live in your own note';
  end if;
  if f.note_id is not distinct from p_note then return; end if;
  update public.files set note_id = p_note where id = f.id;
  insert into public.audit_log (hive_id, member_id, action, detail)
  values (f.hive_id, f.member_id, 'file.home_changed',
          jsonb_build_object('file_id', f.id, 'from', f.note_id, 'to', p_note));
end
$$;

revoke all on function public._sync_orphan(text, uuid) from public, anon, authenticated;
revoke all on function public._sync_home(public.sync_keys, text) from public, anon, authenticated;
revoke all on function public._sync_count(jsonb) from public, anon;
revoke all on function public.sync_put_files(uuid, jsonb) from public, anon;
revoke all on function public.sync_delete(uuid, text[]) from public, anon;
revoke all on function public.sync_finish(uuid, jsonb, text[], text) from public, anon;
grant execute on function public.sync_put_files(uuid, jsonb) to authenticated;
grant execute on function public.sync_delete(uuid, text[]) to authenticated;
grant execute on function public.sync_finish(uuid, jsonb, text[], text) to authenticated;
