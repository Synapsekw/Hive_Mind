-- 20261124082437_hive_cap.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp). Do not hand-edit
-- the version, and never edit a migration that has shipped.
--
-- What this migration does:
--   The app is about to let any signed-in person start a hive, so create_hive
--   checks what it is given and limits how many hives one person owns.
--
--   - Both names are trimmed of white space at the ends (space, tab, newline,
--     carriage return, form feed and the vertical tab, \x0B) and stored that
--     way. The hive's name and the person's name in it are each 1 to 60
--     characters after trimming. The refusals are 'a hive needs a name',
--     'that hive name is too long', 'you need a name in the hive' and
--     'that name is too long', looked at in that order.
--   - A person owns at most 5 hives: their memberships with the role 'owner'
--     are counted, and a sixth is refused with 'you already own 5 hives'.
--     Hives they only belong to do not count. The count is made under a lock
--     for that person, so two calls arriving together cannot both count 4.
--   - Each new hive is in the audit log as hive.created, with the hive, the
--     owner's new member and the hive's name.
--
--   The signature, the grants and the rest are as before: an app pass, an
--   agent and a caller with nobody signed in are refused first, and the hive
--   gets its owner and that owner's "Main" workspace. No policy changes, and
--   nobody reads anything they could not read before.

create or replace function public.create_hive(p_name text, p_display_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_space constant text := E' \t\n\r\f\x0B';
  v_name text := btrim(coalesce(p_name, ''), v_space);
  v_display text := btrim(coalesce(p_display_name, ''), v_space);
  v_uid uuid := (select auth.uid());
  v_hive uuid;
  v_member uuid;
begin
  if public.jwt_oauth_client() is not null then
    raise exception 'an app pass cannot do this';
  end if;
  if v_uid is null or public.jwt_agent_id() is not null then
    raise exception 'sign in as a person to create a hive';
  end if;

  if v_name = '' then
    raise exception 'a hive needs a name';
  end if;
  if char_length(v_name) > 60 then
    raise exception 'that hive name is too long';
  end if;
  if v_display = '' then
    raise exception 'you need a name in the hive';
  end if;
  if char_length(v_display) > 60 then
    raise exception 'that name is too long';
  end if;

  -- One new hive of a person at a time, so calls arriving together cannot
  -- each count 4 and all pass the limit. Held until the transaction ends.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('create_hive:' || v_uid::text, 0));
  if (select count(*) from public.members m
       where m.user_id = v_uid and m.role = 'owner') >= 5 then
    raise exception 'you already own 5 hives';
  end if;

  insert into public.hives (name) values (v_name) returning id into v_hive;
  insert into public.members (hive_id, user_id, display_name, role)
    values (v_hive, v_uid, v_display, 'owner') returning id into v_member;
  insert into public.workspaces (hive_id, member_id, name) values (v_hive, v_member, 'Main');
  insert into public.audit_log (hive_id, member_id, action, detail)
    values (v_hive, v_member, 'hive.created', pg_catalog.jsonb_build_object('name', v_name));
  return v_hive;
end
$$;
