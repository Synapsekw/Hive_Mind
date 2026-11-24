-- 20261124160731_workspace_delete.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp). Do not hand-edit
-- the version, and never edit a migration that has shipped.
--
-- What this migration does:
--   The app is about to let a person delete a workspace of their own in
--   Settings. Who may delete is unchanged: the workspaces_delete policy (the
--   workspace's owner, signed in as a person; never an agent, never an app
--   pass) is not touched, and the workspace's folders, notes, note versions
--   and links still go with it by the foreign keys' cascades. This adds what
--   a delete must not break, and a record of it.
--
--   - workspace_delete(), one trigger function, attached to public.workspaces
--     as zzzz_workspace_delete, before delete, for each row. Triggers of one
--     kind run in the order of their names, so it runs after zz_hive_frozen:
--     a hive that is being deleted still answers 'this hive is being deleted'.
--   - The three refusals bind a caller that comes through the API (the
--     session's role is anon or authenticated: current_setting('role'), which
--     the API sets from the verified token, as workspace_cap reads it), and
--     only while the workspace's member is still there:
--       'you need at least one workspace'           the member's last one;
--       'this workspace still has an agent in use'  an agent of it that is
--                                                   not revoked: the person
--                                                   revokes it first, so an
--                                                   app's sign-in is ended
--                                                   the usual way;
--       'this workspace still holds files'          a row in public.files:
--                                                   the stored object would
--                                                   be left behind with
--                                                   nobody able to remove it.
--     Row-level security filters rows ahead of the trigger, so somebody
--     else's workspace fires nothing and these say nothing about anyone else.
--   - The server and the database's owner are not held to them: the erase of
--     a hive (20261124091833_hive_deletion.sql) deletes workspaces itself.
--     A workspace that goes because its member is being deleted is not held
--     to them either: the member's row is gone by then.
--   - When a person is signed in and the workspace's member and hive are
--     still there, one audit_log row is written: action 'workspace.deleted',
--     the person's member row, and
--     detail = { "notes": <notes in it>, "folders": <folders in it> }.
--     Never the workspace's name, a path, a title or a body. Each note still
--     gets its own 'note.deleted' row from notes_deleted_audit, as before.
--     The rows are written in the delete's own transaction and go with it if
--     the delete fails.
--   - The counts and the checks read by indexed columns: workspaces by
--     member_id (the unique (member_id, name)), notes and folders by
--     workspace_id (the unique (workspace_id, path)). Agents and files have
--     no index that leads with workspace_id, so both get one.
--
--   No policy changes and no grant changes: nobody deletes anything they
--   could not delete before.

create index agents_workspace_idx on public.agents (workspace_id);
create index files_workspace_idx on public.files (workspace_id);

create function public.workspace_delete() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_api boolean :=
    coalesce(pg_catalog.current_setting('role', true), '') in ('anon', 'authenticated');
begin
  -- The workspace goes with its member (or its hive): nothing to keep.
  if not exists (select 1 from public.members m where m.id = old.member_id) then
    return old;
  end if;

  if v_api then
    -- One delete of a member's workspaces at a time, so two arriving together
    -- cannot each see another workspace left and both pass.
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('workspace_cap:' || old.member_id::text, 0));
    if not exists (select 1 from public.workspaces w
                    where w.member_id = old.member_id and w.id <> old.id) then
      raise exception 'you need at least one workspace';
    end if;
    if exists (select 1 from public.agents a
                where a.workspace_id = old.id and a.revoked_at is null) then
      raise exception 'this workspace still has an agent in use';
    end if;
    if exists (select 1 from public.files f where f.workspace_id = old.id) then
      raise exception 'this workspace still holds files';
    end if;
  end if;

  if v_uid is not null
     and exists (select 1 from public.hives h where h.id = old.hive_id) then
    insert into public.audit_log (hive_id, member_id, agent_id, action, detail)
    values (
      old.hive_id,
      (select m.id from public.members m
        where m.hive_id = old.hive_id and m.user_id = v_uid),
      public.jwt_agent_id(),
      'workspace.deleted',
      jsonb_build_object(
        'notes', (select count(*) from public.notes n where n.workspace_id = old.id),
        'folders', (select count(*) from public.folders f where f.workspace_id = old.id)));
  end if;
  return old;
end
$$;

create trigger zzzz_workspace_delete before delete on public.workspaces
  for each row execute function public.workspace_delete();

-- The database's own: a trigger function is never called by hand.
revoke all on function public.workspace_delete() from public, anon, authenticated;
