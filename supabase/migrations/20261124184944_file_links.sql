-- 20261124184944_file_links.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp). Do not hand-edit
-- the version, and never edit a migration that has shipped.
--
-- What this migration does:
--   - files.kind: what a file is for showing it, decided once on insert from
--     the name's extension and the declared type together (a mismatch is
--     'other'; SVG and HTML are always 'other'). Same table as
--     web/src/gallery/kind.ts; both are tested against tests/fixtures/kind-cases.json.
--   - Indexes for the gallery's bounded reads: (hive_id, created_at, id) and
--     (hive_id, kind, created_at).
--   - public.file_references: a note mentions a file. Grants no access:
--     files_select does not look at it. A row shows only to someone who can
--     read both the file and the note.
--   - file_set_home: a person moves a file's home note (who may read it
--     follows the home note). Owner only, never an agent; audited.
--   - files_deleted_audit: deleting a file writes one audit row (file id only).

create function public.file_kind(p_name text, p_mime text) returns text
language sql immutable set search_path = '' as $$
  select case
    when ext in ('png') then case when m = 'image/png' then 'image' else 'other' end
    when ext in ('jpg', 'jpeg') then case when m = 'image/jpeg' then 'image' else 'other' end
    when ext = 'gif' then case when m = 'image/gif' then 'image' else 'other' end
    when ext = 'webp' then case when m = 'image/webp' then 'image' else 'other' end
    when ext = 'avif' then case when m = 'image/avif' then 'image' else 'other' end
    when ext = 'pdf' then case when m = 'application/pdf' then 'pdf' else 'other' end
    when ext in ('md', 'txt') then case when m in ('text/markdown', 'text/plain') then 'text' else 'other' end
    when ext = 'csv' then case when m in ('text/csv', 'text/plain') then 'csv' else 'other' end
    when ext = 'pptx' then 'slides'
    when ext = 'xlsx' then 'sheet'
    when ext = 'docx' then 'doc'
    else 'other'
  end
  from (select lower(substring(coalesce(p_name, '') from '\.([^./]+)$')) as ext,
               lower(btrim(split_part(coalesce(p_mime, ''), ';', 1))) as m) x
$$;

alter table public.files add column kind text;
update public.files set kind = public.file_kind(name, mime);
alter table public.files alter column kind set not null;

create function public.files_set_kind() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.kind := public.file_kind(new.name, new.mime);
  return new;
end
$$;
create trigger files_set_kind before insert on public.files
  for each row execute function public.files_set_kind();

create index files_hive_created_idx on public.files (hive_id, created_at desc, id desc);
create index files_hive_kind_idx on public.files (hive_id, kind, created_at desc);

-- ------------------------------------------------------------ references

create table public.file_references (
  file_id uuid not null references public.files on delete cascade,
  note_id uuid not null references public.notes on delete cascade,
  created_by_agent uuid references public.agents on delete set null,
  created_at timestamptz not null default now(),
  primary key (file_id, note_id)
);
create index file_references_note_idx on public.file_references (note_id);
alter table public.file_references enable row level security;

create function public.file_references_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_hive uuid;
begin
  -- This table is not under hive_frozen (it holds no hive column and its rows
  -- go with their file or note), so a closing hive is refused here.
  select f.hive_id into v_hive from public.files f where f.id = new.file_id;
  if v_hive is not null and public.hive_is_closing(v_hive) then
    raise exception 'this hive is being deleted';
  end if;
  new.created_by_agent := public.jwt_agent_id();
  new.created_at := now();
  return new;
end
$$;
create trigger file_references_before_insert before insert on public.file_references
  for each row execute function public.file_references_before_insert();

-- Both lookups run under the caller's own row-level security.
create policy file_references_select on public.file_references for select to authenticated
  using (exists (select 1 from public.files f where f.id = file_id)
         and exists (select 1 from public.notes n where n.id = note_id));
create policy file_references_insert on public.file_references for insert to authenticated
  with check (exists (select 1 from public.files f where f.id = file_id)
              and exists (select 1 from public.notes n
                           where n.id = note_id
                             and n.member_id in (select public.my_member_ids())
                             and public.agent_write_ok(n.workspace_id)));
create policy file_references_delete on public.file_references for delete to authenticated
  using (public.jwt_agent_id() is null
         and exists (select 1 from public.notes n
                      where n.id = note_id and n.member_id in (select public.my_member_ids())));
create policy file_references_no_app on public.file_references as restrictive for all to authenticated
  using (public.jwt_oauth_client() is null)
  with check (public.jwt_oauth_client() is null);

-- ------------------------------------------------------------ home note

create function public.file_set_home(p_file uuid, p_note uuid) returns void
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
revoke all on function public.file_set_home(uuid, uuid) from public, anon;
grant execute on function public.file_set_home(uuid, uuid) to authenticated;

-- ------------------------------------------------------------ delete audit

-- Same guards as notes_deleted_audit: no row for a service delete, none when
-- the whole hive is going.
create function public.files_deleted_audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null
     or not exists (select 1 from public.hives h where h.id = old.hive_id) then
    return old;
  end if;
  insert into public.audit_log (hive_id, member_id, agent_id, action, detail)
  values (
    old.hive_id,
    (select m.id from public.members m where m.hive_id = old.hive_id and m.user_id = v_uid),
    public.jwt_agent_id(),
    'file.deleted',
    jsonb_build_object('file_id', old.id));
  return old;
end
$$;
create trigger files_deleted_audit before delete on public.files
  for each row execute function public.files_deleted_audit();

-- No update and no truncate through the API; rows come in and go out only.
revoke all on public.file_references from anon, authenticated;
grant select, insert, delete on public.file_references to authenticated;

revoke all on function public.files_deleted_audit() from public, anon, authenticated;
revoke all on function public.files_set_kind() from public, anon, authenticated;
revoke all on function public.file_references_before_insert() from public, anon, authenticated;
