-- 20261124110155_workspace_cap.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp). Do not hand-edit
-- the version, and never edit a migration that has shipped.
--
-- What this migration does:
--   The app is about to let a person make a workspace when they import a
--   folder of notes, so a workspace's name is checked and the number of
--   workspaces one member has is limited.
--
--   - workspace_cap(), one trigger function, attached to public.workspaces as
--     zzzz_workspace_cap, before insert and before an update of the name, for
--     each row. A trigger binds every writer alike: a person, the functions
--     that make a member's "Main" workspace, the import script and the
--     database's owner.
--   - The name is trimmed of white space at the ends (space, tab, newline,
--     carriage return, form feed and the vertical tab, \x0B) and stored that
--     way. It is 1 to 60 characters after trimming. The refusals are
--     'a workspace needs a name' and 'that workspace name is too long'.
--     The names the database itself gives ("Main") pass unchanged.
--   - A member has at most 20 workspaces: a 21st is refused with
--     'you already have 20 workspaces'. The count is the member's own, in the
--     one hive that member belongs to; another member is not affected. It is
--     made under a lock for that member, held until the transaction ends, so
--     two inserts arriving together cannot both count 19. A wrong name is
--     said before the limit.
--   - Workspaces that are already there are left as they are, however many a
--     member has and whatever they are called: nothing here rewrites a row,
--     and only a new workspace, or a new name, is checked.
--
--   The order of the refusals. Triggers of one kind run in the order of their
--   names, so this one runs after zz_hive_frozen and zzz_one_hive
--   (20261124091833_hive_deletion.sql). A hive that is being deleted still
--   answers 'this hive is being deleted', and a workspace placed in another
--   hive than its member's still answers 'a workspace belongs to its member's
--   hive', whatever the name and however many workspaces there are.
--
--   What nobody learns. A before trigger answers before row-level security
--   does, so a count made for any member would tell a signed-in caller whether
--   somebody else has 20 workspaces. When the caller comes through the API
--   (the session's role is anon or authenticated: current_setting('role'),
--   which the API sets from the verified token, as the freeze reads it) and
--   the row names a member who is not the signed-in person's own, the count is
--   not made: workspaces_insert refuses that row anyway, with its own answer,
--   as before. Skipping the count never lets a row in: it only leaves the
--   refusal to the policy. The server and the database's owner are counted
--   for every member. The name's two refusals say nothing about anyone.
--
--   No policy changes, no grant changes, and nobody reads or writes anything
--   they could not before: an agent and an app pass are still refused a
--   workspace by workspaces_insert and workspaces_no_app, and a person can
--   still not rename one (there is no update policy on workspaces).
--   The count reads workspaces by member_id, the leading column of the unique
--   index on (member_id, name).

create function public.workspace_cap() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_space constant text := E' \t\n\r\f\x0B';
  v_name text := btrim(coalesce(new.name, ''), v_space);
  v_uid uuid := (select auth.uid());
begin
  if v_name = '' then
    raise exception 'a workspace needs a name';
  end if;
  if char_length(v_name) > 60 then
    raise exception 'that workspace name is too long';
  end if;
  new.name := v_name;

  if tg_op = 'INSERT' then
    -- Somebody else's member, asked for through the API: not counted, so the
    -- answer says nothing about them. Row-level security refuses the row.
    if coalesce(pg_catalog.current_setting('role', true), '') in ('anon', 'authenticated')
       and not exists (select 1 from public.members m
                        where m.id = new.member_id and m.user_id = v_uid) then
      return new;
    end if;
    -- One new workspace of a member at a time, so inserts arriving together
    -- cannot each count 19 and all pass the limit.
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('workspace_cap:' || new.member_id::text, 0));
    if (select count(*) from public.workspaces w
         where w.member_id = new.member_id) >= 20 then
      raise exception 'you already have 20 workspaces';
    end if;
  end if;
  return new;
end
$$;

create trigger zzzz_workspace_cap before insert or update of name on public.workspaces
  for each row execute function public.workspace_cap();

-- The database's own: a trigger function is never called by hand.
revoke all on function public.workspace_cap() from public, anon, authenticated;
