-- 20261123123845_note_delete_audit.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp). Do not hand-edit
-- the version, and never edit a migration that has shipped.
--
-- What this migration does:
--   Records a deleted note in the audit log. Who may delete is unchanged: the
--   notes_delete policy (the note's owner, signed in as a person; never an
--   agent) is not touched.
--
--   - notes_deleted_audit: a trigger before delete on public.notes, for each
--     row. When a person is signed in and the note's hive still exists, it
--     writes one audit_log row: action 'note.deleted', the note's id, the
--     person's member row in that hive, and
--     detail = { "links": <links to or from the note>,
--                "files": <files attached to the note> }.
--     Never the note's path, title or body.
--   - Before, not after, so the links and files it counts are still there. The
--     row is written in the delete's own transaction and goes with it if the
--     delete fails. Row-level security filters rows ahead of the trigger, so a
--     refused delete fires nothing.
--   - No row when nobody is signed in (a service delete), and no row when the
--     note goes because its whole hive is being deleted: the audit log goes
--     with the hive, and a row pointing at a hive that is gone would fail the
--     delete.
--   - The counts read by indexed columns: links (from_note) through the
--     unique (from_note, to_note), links_to_idx (to_note), files_note_idx
--     (note_id). No index is added.

create function public.notes_deleted_audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
begin
  -- The hive's own row is deleted before its notes are (the notes go by the
  -- foreign key's cascade), so by now it is no longer there to be found.
  if v_uid is null
     or not exists (select 1 from public.hives h where h.id = old.hive_id) then
    return old;
  end if;
  insert into public.audit_log (hive_id, member_id, agent_id, action, note_id, detail)
  values (
    old.hive_id,
    -- Null when the person's member row has just been deleted (the note goes
    -- with the member) or when they are not in the hive.
    (select m.id from public.members m
      where m.hive_id = old.hive_id and m.user_id = v_uid),
    public.jwt_agent_id(),
    'note.deleted',
    old.id,
    jsonb_build_object(
      'links', (select count(*) from public.links l
                 where l.from_note = old.id or l.to_note = old.id),
      'files', (select count(*) from public.files f where f.note_id = old.id)));
  return old;
end
$$;

create trigger notes_deleted_audit before delete on public.notes
  for each row execute function public.notes_deleted_audit();

-- A trigger function is never called by hand.
revoke all on function public.notes_deleted_audit() from public, anon, authenticated;
