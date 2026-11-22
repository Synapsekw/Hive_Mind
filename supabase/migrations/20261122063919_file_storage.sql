-- Hive Mind: file storage.
-- One private bucket. A file lives under its owner's member and workspace:
--   <member_id>/<workspace_id>/outputs/<type>/<customer>/<name>
-- It is read by whoever may read the note it is attached to, and otherwise only
-- by its owner. Agents upload inside their own workspace and never overwrite or
-- delete. Self-hosted agents cannot save files until there is a way to hold
-- a file for review.

insert into storage.buckets (id, name, public, file_size_limit)
values ('files', 'files', false, 52428800)
on conflict (id) do nothing;

-- ---------------------------------------------------------------- helpers

-- The path sits under one of the caller's own workspaces.
create function public.owns_file_path(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.workspaces w
    where w.member_id in (select public.my_member_ids())
      and p_name like w.member_id::text || '/' || w.id::text || '/%'
  )
$$;

-- The caller may put a new file at this path.
create function public.can_write_file(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select not public.jwt_is_self_hosted() and exists (
    select 1 from public.workspaces w
    where w.member_id in (select public.my_member_ids())
      and public.agent_write_ok(w.id)
      and p_name like w.member_id::text || '/' || w.id::text || '/%'
  )
$$;

-- Not security definer on purpose: the lookup in public.files runs under the
-- caller's own row-level security, so a file follows the note it is attached to.
create function public.can_read_file(p_name text) returns boolean
language sql stable set search_path = '' as $$
  select (public.owns_file_path(p_name) and not public.jwt_is_self_hosted())
      or exists (select 1 from public.files f where f.storage_path = p_name)
$$;

-- ------------------------------------------------------------ the files table

-- A row may only point at a path under its own member and workspace. Without
-- this, a row naming someone else's path would make their file readable.
create function public.files_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  w public.workspaces;
begin
  if public.jwt_is_self_hosted() then
    raise exception 'self-hosted agents cannot save files yet';
  end if;
  select * into w from public.workspaces where id = new.workspace_id;
  if not found or w.member_id <> new.member_id then
    raise exception 'workspace does not belong to this member';
  end if;
  new.hive_id := w.hive_id;
  if new.storage_path not like new.member_id::text || '/' || new.workspace_id::text || '/%' then
    raise exception 'a file must be stored under its own member and workspace';
  end if;
  if new.note_id is not null and not exists (
       select 1 from public.notes n
        where n.id = new.note_id and n.member_id = new.member_id) then
    raise exception 'a file can only be attached to your own note';
  end if;
  return new;
end
$$;

create trigger files_before_insert before insert on public.files
  for each row execute function public.files_before_insert();

-- ------------------------------------------------------------ stored objects

create policy hive_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'files' and public.can_write_file(name));

create policy hive_files_select on storage.objects for select to authenticated
  using (bucket_id = 'files' and public.can_read_file(name));

-- People remove their own files. There is no update policy: nobody overwrites.
create policy hive_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'files'
         and public.owns_file_path(name)
         and public.jwt_agent_id() is null);
