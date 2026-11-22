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
--   - public.note_folder_rule(notes): internal; the rule folder of a note.
--   - public.note_visibility / note_shared_with: replaced to use it.
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
-- count. Internal: nobody signed in may call it directly (it would hand out the
-- owner's folder row).
--
-- It answers only for the workspace's owner, or for a row that is stored as
-- given (same id, workspace and path). The callers below are executable by
-- every signed-in user, and a forged row (someone's workspace id plus a
-- guessed path) must not reveal that a rule exists or whom it names. The
-- owner branch keeps a new row (insert ... returning) working; for everyone
-- else the stored-row check is one primary-key lookup. plpgsql, so the check
-- runs only when a rule folder was found (and its plans are cached): measured
-- faster under row-level security than a single SQL statement with the guard.
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
  if exists (select 1 from public.workspaces w
              where w.id = n.workspace_id
                and w.member_id in (select public.my_member_ids()))
     or exists (select 1 from public.notes s
                 where s.id = n.id
                   and s.workspace_id = n.workspace_id
                   and s.path = n.path) then
    return f;
  end if;
  return null;
end
$$;

-- Note override, else the nearest folder rule, else the member's default.
-- Security definer, as before: it reads the owner's folders for a colleague.
create or replace function public.note_visibility(n public.notes)
returns public.visibility
language sql stable security definer set search_path = '' as $$
  select coalesce(
    n.visibility,
    (select r.visibility from public.note_folder_rule(n) r),
    (select m.default_visibility from public.members m where m.id = n.member_id)
  )
$$;

create or replace function public.note_shared_with(n public.notes) returns uuid[]
language sql stable security definer set search_path = '' as $$
  select case
    when n.visibility is not null then n.shared_with
    else coalesce((select r.shared_with from public.note_folder_rule(n) r), '{}')
  end
$$;

-- The path of the note's rule folder, or null. Decided on the stored row, and
-- null when the caller cannot read that note, so a forged row reveals nothing.
create function public.note_rule_folder(n public.notes) returns text
language sql stable security definer set search_path = '' as $$
  select (select r.path from public.note_folder_rule(x) r)
    from public.notes x
   where x.id = n.id
     and public.can_read_note(x)
$$;

-- Why the caller can read the note: 'own', 'shared' (the whole hive, or named
-- members including the caller) or 'link' (only through an accepted link).
-- Null when the caller cannot read it.
create function public.note_access(n public.notes) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when x.member_id in (select public.my_member_ids()) then 'own'
    when public.note_visibility(x) = 'group'
      or (public.note_visibility(x) = 'members'
          and public.note_shared_with(x) && array(select public.my_member_ids()))
      then 'shared'
    else 'link'
  end
    from public.notes x
   where x.id = n.id
     and public.can_read_note(x)
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
    v_eff_from := jsonb_build_object('visibility', public.note_visibility(old),
                                     'shared_with', to_jsonb(public.note_shared_with(old)));
    v_eff_to := jsonb_build_object('visibility', public.note_visibility(new),
                                   'shared_with', to_jsonb(public.note_shared_with(new)));
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

-- ------------------------------------------------------------------ grants

revoke all on function
  public.note_folder_rule(public.notes),
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
