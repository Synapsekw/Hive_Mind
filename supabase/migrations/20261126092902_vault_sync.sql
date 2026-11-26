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
