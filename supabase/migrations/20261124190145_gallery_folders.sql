-- 20261124190145_gallery_folders.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp). Do not hand-edit
-- the version, and never edit a migration that has shipped.
--
-- What this migration does:
--   A person's own folders in the gallery, two levels deep, holding any files
--   they can read. Organisation only: a gallery folder never changes who may
--   read a file (that is the file's home note). Separate from public.folders,
--   whose rules do share notes. Owner only; agents and apps never.
--   A file goes only into a folder of the hive it lives in. Neither table is
--   under hive_frozen (rows go with their member or file), so their insert
--   triggers refuse a hive that is being deleted.

create table public.gallery_folders (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members on delete cascade,
  parent_id uuid references public.gallery_folders on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  created_at timestamptz not null default now()
);
create unique index gallery_folders_name_idx on public.gallery_folders
  (member_id, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(btrim(name)));
create index gallery_folders_parent_idx on public.gallery_folders (parent_id);

create table public.gallery_folder_files (
  folder_id uuid not null references public.gallery_folders on delete cascade,
  file_id uuid not null references public.files on delete cascade,
  added_at timestamptz not null default now(),
  primary key (folder_id, file_id)
);
create index gallery_folder_files_file_idx on public.gallery_folder_files (file_id);

create function public.gallery_folders_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  p public.gallery_folders;
  v_hive uuid;
begin
  new.name := btrim(new.name);
  if tg_op = 'INSERT' then
    select m.hive_id into v_hive from public.members m where m.id = new.member_id;
    if v_hive is not null and public.hive_is_closing(v_hive) then
      raise exception 'this hive is being deleted';
    end if;
  end if;
  if new.parent_id = new.id then
    raise exception 'folders go two levels deep at most';
  end if;
  if new.parent_id is not null then
    select * into p from public.gallery_folders where id = new.parent_id;
    if not found or p.member_id <> new.member_id then
      raise exception 'a folder can only sit in your own folder';
    end if;
    if p.parent_id is not null then
      raise exception 'folders go two levels deep at most';
    end if;
    if tg_op = 'UPDATE' and exists (
         select 1 from public.gallery_folders c where c.parent_id = new.id) then
      raise exception 'folders go two levels deep at most';
    end if;
  end if;
  if tg_op = 'UPDATE' and new.member_id <> old.member_id then
    raise exception 'a folder cannot change hands';
  end if;
  return new;
end
$$;
create trigger gallery_folders_before_write before insert or update on public.gallery_folders
  for each row execute function public.gallery_folders_before_write();

create function public.gallery_folder_files_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_hive uuid;
begin
  select m.hive_id into v_hive
    from public.gallery_folders g join public.members m on m.id = g.member_id
   where g.id = new.folder_id;
  if v_hive is not null and public.hive_is_closing(v_hive) then
    raise exception 'this hive is being deleted';
  end if;
  new.added_at := now();
  return new;
end
$$;
create trigger gallery_folder_files_before_insert before insert on public.gallery_folder_files
  for each row execute function public.gallery_folder_files_before_insert();

alter table public.gallery_folders enable row level security;
alter table public.gallery_folder_files enable row level security;

create policy gallery_folders_own on public.gallery_folders for all to authenticated
  using (member_id in (select public.my_member_ids()) and public.jwt_agent_id() is null)
  with check (member_id in (select public.my_member_ids()) and public.jwt_agent_id() is null);
create policy gallery_folders_no_app on public.gallery_folders as restrictive for all to authenticated
  using (public.jwt_oauth_client() is null)
  with check (public.jwt_oauth_client() is null);

create policy gallery_folder_files_select on public.gallery_folder_files for select to authenticated
  using (public.jwt_agent_id() is null
         and exists (select 1 from public.gallery_folders g
                      where g.id = gallery_folder_files.folder_id
                        and g.member_id in (select public.my_member_ids())));
-- The file must be readable by the caller (files_select runs on f) and live in
-- the hive of the folder's member.
create policy gallery_folder_files_insert on public.gallery_folder_files for insert to authenticated
  with check (public.jwt_agent_id() is null
              and exists (select 1 from public.gallery_folders g
                           join public.members m on m.id = g.member_id
                          where g.id = gallery_folder_files.folder_id
                            and g.member_id in (select public.my_member_ids())
                            and exists (select 1 from public.files f
                                         where f.id = gallery_folder_files.file_id
                                           and f.hive_id = m.hive_id)));
create policy gallery_folder_files_delete on public.gallery_folder_files for delete to authenticated
  using (public.jwt_agent_id() is null
         and exists (select 1 from public.gallery_folders g
                      where g.id = gallery_folder_files.folder_id
                        and g.member_id in (select public.my_member_ids())));
create policy gallery_folder_files_no_app on public.gallery_folder_files as restrictive for all to authenticated
  using (public.jwt_oauth_client() is null)
  with check (public.jwt_oauth_client() is null);

-- No truncate (or references/trigger) through the API.
revoke all on public.gallery_folders from anon, authenticated;
grant select, insert, update, delete on public.gallery_folders to authenticated;
revoke all on public.gallery_folder_files from anon, authenticated;
grant select, insert, delete on public.gallery_folder_files to authenticated;

revoke all on function public.gallery_folders_before_write() from public, anon, authenticated;
revoke all on function public.gallery_folder_files_before_insert() from public, anon, authenticated;
