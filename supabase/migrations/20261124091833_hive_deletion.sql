-- 20261124091833_hive_deletion.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp). Do not hand-edit
-- the version, and never edit a migration that has shipped.
--
-- What this migration does:
--   Deleting a hive, with seven days to cancel. The owner marks the hive; for
--   seven days everyone in it can still read and nobody can write; the owner
--   can cancel; then the server erases it, in steps, and keeps a record.
--
--   The mark
--   - hives gains closing_at, delete_after (closing_at + 7 days), closing_by
--     (the auth user who asked) and purging_at (set when the server starts
--     to erase). A hive whose delete_after is set is closing. Members read
--     the columns with the hive's row, as they read its name; nobody writes
--     them through the API (hives has no update policy), only the functions
--     below.
--   - hive_deletion_preview(hive): how many members, notes and files the hive
--     holds. request_hive_deletion(hive, name): the typed name must be the
--     hive's own; marks the hive and answers delete_after. Asking again
--     answers the same date and changes nothing. cancel_hive_deletion(hive):
--     clears the mark, until the erase has begun: after that it answers
--     'this hive is already being erased'. All three are for the hive's
--     owner, signed in as a person: an app pass, an agent, a self-hosted
--     claim and a caller with nobody signed in are refused first; a person
--     who is not a member is told 'hive not found', exactly as for a hive
--     that does not exist; a member who is not the owner is told 'only the
--     owner can delete a hive'. Request and cancel are in the audit log as
--     hive.deletion_requested and hive.deletion_cancelled, with the date.
--
--   The freeze
--   - hive_frozen(), one trigger function, attached as zz_hive_frozen before
--     insert, update and delete, for each row, to every table that holds
--     hive data. It raises 'this hive is being deleted' when the row, before
--     or after the change, belongs to a closing hive. A trigger binds every
--     writer alike: a person, an agent, the connector, the security definer
--     functions (which bypass row-level security) and the database's owner.
--     No function needs a guard of its own.
--     How each table finds its hive, and every route is looked at, so a row
--     that names one hive and hangs under another is held by both:
--       members          hive_id
--       workspaces       hive_id; member_id -> members
--       agents           member_id -> members; workspace_id -> workspaces
--       folders          workspace_id -> workspaces; member_id -> members
--       notes            hive_id; workspace_id -> workspaces; member_id -> members
--       note_versions    note_id -> notes
--       files            hive_id; workspace_id -> workspaces; member_id -> members
--       entities         hive_id
--       note_entities    note_id -> notes; entity_id -> entities
--       links            hive_id; from_note, to_note -> notes
--       synthesis_pages  hive_id; entity_id -> entities
--       invitations      hive_id
--     An update is checked on the row as it was and as it would be, so a row
--     cannot be moved out of a closing hive or into one.
--   - TRUNCATE fires no row trigger, so the right to truncate is taken from
--     anon and authenticated on every table of a hive.
--   - Stored objects: can_write_file refuses a path under a workspace of a
--     closing hive, and the delete policy on storage.objects now also asks
--     can_delete_file, which refuses the same. The server's own key is not
--     bound by either: it removes the objects when the hive is erased.
--
--   One hive per row
--   - A row could name parents in two hives: a workspace whose hive_id is not
--     its member's hive (workspaces_insert allowed it to a person in both), a
--     note tied to an entity of another hive (note_entities_insert), a tag
--     confirmed by a member of another hive, a note pointing at a folder of
--     another workspace. With such a row a member of two hives could make the
--     erase of one fail by keeping the other one closing. one_hive(), attached
--     as zzz_one_hive before insert and update, now refuses them, for every
--     writer:
--       workspaces       hive_id is the member's hive
--       agents           the workspace belongs to the member
--       notes            folder_id names a folder of the note's own workspace
--       note_entities    the note and the entity are in one hive, and so is
--                        the member who confirmed the tag
--       synthesis_pages  hive_id is the entity's hive
--       entities         hive_id never changes ('an entity stays in its
--                        hive'): entities_update let the owner of two hives
--                        move one, and its tags with it
--     and it keeps notes.written_by_agent the database's own. A person could
--     set it to any agent, of any hive, by an update that changed no content
--     (notes_before_write stamps it only when the content changes): a
--     reference across hives, and a forged "written by". Now an update that
--     does not change the title, body or frontmatter keeps the value the row
--     had, silently, as notes_before_write already does for version; the one
--     exception is the foreign key emptying it when the agent is deleted.
--     Nothing legitimate set the column by hand: agents and people write
--     notes through the API and get it from notes_before_write, and
--     scripts/import-vault.mjs and the demo never send it.
--     The other tables were already held: folders, notes and files by their
--     own triggers (the workspace belongs to the member, hive_id is the
--     workspace's, a file's note is its member's own), links by
--     links_before_insert (both notes in one hive), and agents, invitations
--     and links' ended_by are written only by functions that take the member
--     and the hive from one row. This migration stops, and changes nothing,
--     if the database holds such a row today.
--
--   The erase
--   - deleted_hives: the record that outlives the hive (its id and name, who
--     asked and when, when it was erased, how many members, notes and files
--     it held). Row-level security is on with no policy and the API roles
--     hold no right on it: only the server reads it.
--   - Five functions, executable by service_role only. Stored objects are not
--     the database's to remove: the purge-hives function removes them
--     between the first step and the last.
--       hives_due_for_purge()   the closing hives whose date has come, at
--                               most 20: those never attempted first, then
--                               the ones attempted longest ago, so a hive
--                               that keeps failing does not hold the others.
--       begin_hive_purge(hive)  the point of no return. Checks the date under
--                               a lock on the hive's row, stamps purging_at
--                               (again on every call: the stamp orders the
--                               queue) and, the first time, writes the record
--                               with the counts as they are then and no
--                               purged_at. From here the owner cannot cancel,
--                               so a hive is never kept with its files gone.
--       hive_object_paths(hive, after, limit)
--                               the stored objects under the hive's members,
--                               by name, a page at a time, whether or not a
--                               files row names them. Only for a hive whose
--                               erase has begun.
--       purge_hive(hive)        one step, within a budget of 2,000 rows,
--                               because the API gives a statement 8 seconds
--                               and a member can pile up rows of any kind.
--                               It empties the hive's tables one after the
--                               other, each only when the tables that point
--                               at it are empty, so no delete cascades:
--                                 note_versions, note_entities, links, files,
--                                 synthesis_pages, notes, folders, entities,
--                                 invitations, notifications, audit_log,
--                                 agents, workspaces, members.
--                               It answers false when the budget is used up.
--                               In the call that finds every table empty it
--                               deletes the hive's row, stamps the record's
--                               purged_at and answers true. It does not
--                               delete the members, or the hive's row, while
--                               a stored object is left under one of the
--                               members: 'stored objects remain'. Refused
--                               before begin_hive_purge.
--     An agent, a workspace and a member count as 20 rows each: deleting one
--     makes the foreign keys look through tables that have no index on the
--     column (audit_log and notes for an agent; files and agents for a
--     workspace; several for a member), so at most 100 of them go in a call.
--     Every other delete finds its rows, and its children, by an index;
--     links_hive_idx, workspaces_hive_idx, invitations_hive_idx,
--     notifications_hive_idx and agents_member_idx are added for that.
--     The audit triggers on notes and folders write nothing when nobody is
--     signed in, as the server is not; the audit log is emptied after both,
--     and whatever is left goes with the hive's row.
--
--   What is deliberately not frozen, and why:
--   - Reading. No policy and no reading function changes.
--   - hives itself: cancelling has to clear the mark, and erasing has to
--     delete the row. Nobody writes it through the API.
--   - audit_log: the request and the cancel are recorded there, and an owner
--     should see who tried what. Nobody writes it through the API.
--   - notifications: marking one as read (read_at, the only column a person
--     may update) changes nothing a hive holds. Nobody inserts or deletes
--     them through the API.
--   - deleted_hives: it belongs to no hive.
--   - Signing in. agent_login stamps agents.last_used_at, and
--     connector_login stamps it too and brings an app's agents.trust_tier in
--     line with the app's registration. An update of an agent's row that
--     changes last_used_at and nothing else passes; for an agent that stands
--     for an app (oauth_client_id is set) trust_tier may change with it.
--     Nothing else on the row may: not for a token agent's trust_tier, which
--     is the tier it signs in with. So agents keep reading for the seven
--     days, and a connected app is still held for review the moment its
--     registration stops being a known vendor's.
--   - Cutting an agent off. A token that leaked must not stay good for seven
--     days, so an update of an agent's row that sets revoked_at where it was
--     empty, and changes nothing else, passes. That is revoke_agent, and the
--     revoke connect_app makes when a person moves an app from the closing
--     hive to another one (a person has one live agent per app). Each of
--     these exceptions is one column and nothing with it: a revoke cannot
--     carry another change, cannot be taken back and cannot be stamped
--     again, so connecting the app once more in the closing hive, which
--     would lift the revoke, is refused.
--   - A hive that is gone. In the cascade that follows the delete of a
--     hive's row, that row is no longer there, and a row whose hives are all
--     gone is not frozen. This lets no row into a closing hive: the freeze
--     looks at every hive a row reaches, and a row that reaches none (its
--     member, workspace, note or hive does not exist) is refused by the
--     foreign keys and by the tables' own triggers, as before.
--   - A cascade, whatever else the row hangs under. A DELETE passes when a
--     parent the old row names (its hive, member, workspace, note or entity)
--     is no longer there, and an UPDATE passes when all it does is empty a
--     column whose parent is no longer there (what "on delete set null"
--     does: notes.folder_id and written_by_agent, files.note_id,
--     note_entities.confirmed_by, invitations.invited_by and
--     accepted_member, links.ended_by). A statement of its own always finds
--     every parent, because the foreign keys hold, so these two only ever
--     apply inside a cascade, and the row the cascade started from was
--     itself checked by the trigger on its own table, or is the hive's row,
--     which only purge_hive deletes. A member's auth user is not such a
--     parent: deleting an account does not take a member out of a closing
--     hive. So a row left over from before one_hive, half in a hive that is
--     being erased and half in another that is closing, cannot stop the
--     erase.
--   - The server's steps. While purging_at is set, a DELETE of a row of that
--     hive passes when two things hold: the session's role is service_role
--     (current_setting('role'), which the API sets from the verified token,
--     not a claim), and the transaction carries purge_hive's marker for that
--     very hive (the setting hive.purging, which purge_hive sets for its own
--     transaction and clears before it answers). So the deletes that pass
--     are the ones purge_hive makes, for the hive it was called for: the
--     service role deleting a row by itself is refused, and so is a step of
--     one hive's erase reaching into another's.
--     What this rests on, plainly: neither the role nor the marker is a
--     secret. The API connects as a role that may become service_role, so a
--     session that can run SQL of its own (SET ROLE, set_config) can give
--     itself both. The gate holds because the API offers no way to run
--     either: it runs the statements of its own making and the functions of
--     this schema, none of which sets a role or a setting from what a caller
--     sends. A person, an agent and an app pass are all authenticated, and
--     are refused every write, deletes too, until the hive is gone. The
--     database's owner is refused as well: a step is run by calling
--     purge_hive as service_role.
--
--   Two writers at once: the trigger reads the hive's row with a key-share
--   lock, and request_hive_deletion takes the row for update. So a request
--   waits for the writes already under way, and a write that arrives while a
--   request is being made waits for it and is then refused. Foreign keys take
--   the same lock on every insert, and invite_member's own lock on the hive's
--   row (for no key update) does not conflict with it. cancel, begin and
--   purge take the row for update too: whichever comes second sees what the
--   first one did.
--
--   Known and accepted:
--   - A revoked agent cannot be revoked again in a closing hive: revoke_agent
--     answers 'this hive is being deleted' for it, where on an open hive it
--     stamps the time again. The agent stays revoked either way.
--   - A member's row cannot be deleted while their hive is closing, so an
--     account in a closing hive cannot be deleted until it is erased.
--   - The freeze answers before row-level security does on an insert, so a
--     caller who names a row of a closing hive learns that it is closing.
--   - A step's time is bounded by its rows, not by the size of the tables:
--     except for the agents, workspaces and members it deletes (at most 100
--     a call), where the foreign keys read tables without an index on the
--     referencing column. Those reads grow with the whole database, not with
--     the hive.
--   - Counts read by index: members (hive_id, user_id), notes_hive_idx,
--     files_hive_idx. hives_delete_after_idx is added for the due list.

-- ------------------------------------------------------------------ the mark

alter table public.hives
  add column closing_at timestamptz,
  add column delete_after timestamptz,
  add column closing_by uuid,
  add column purging_at timestamptz;
-- The two dates are set and cleared together, and only a closing hive is
-- being erased.
alter table public.hives add constraint hives_closing_dates
  check ((closing_at is null) = (delete_after is null)
         and (purging_at is null or delete_after is not null));
-- What hives_due_for_purge reads by: only closing hives are in it.
create index hives_delete_after_idx on public.hives (delete_after)
  where delete_after is not null;

-- True while the hive is closing. False for a hive that is not there. The
-- database's own: called by the functions below, which run as their owner.
create function public.hive_is_closing(p_hive uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.hives h
                  where h.id = p_hive and h.delete_after is not null)
$$;

-- ---------------------------------------------------------------- the freeze

-- Attached to every table that holds hive data. Security definer, so it reads
-- the hive whoever is writing. OLD and NEW are null records where they do not
-- apply, so each array below holds the old value, the new one, or both.
create function public.hive_frozen() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_hives uuid[] := '{}';
  v_members uuid[] := '{}';
  v_workspaces uuid[] := '{}';
  v_notes uuid[] := '{}';
  v_entities uuid[] := '{}';
  -- The columns of this table that a foreign key empties when the row they
  -- point at is deleted.
  v_emptied text[] := '{}';
  v_ids uuid[];
  v_closing boolean := false;
  -- The hives the row reaches whose erase has begun.
  v_purging uuid[] := '{}';
  v_old jsonb;
  v_new jsonb;
  v_column text;
  v_parent uuid;
  v_there boolean;
  v_cascade boolean;
  h record;
begin
  if tg_table_schema <> 'public' then
    raise exception 'hive_frozen does not know %.%', tg_table_schema, tg_table_name;
  end if;
  case tg_table_name
    when 'members', 'entities' then
      v_hives := array[old.hive_id, new.hive_id];
    when 'invitations' then
      v_hives := array[old.hive_id, new.hive_id];
      v_emptied := array['invited_by', 'accepted_member'];
    when 'workspaces' then
      v_hives := array[old.hive_id, new.hive_id];
      v_members := array[old.member_id, new.member_id];
    when 'agents' then
      -- Signing in: the last-used stamp, and for an app's agent the trust
      -- tier that follows its registration. And cutting an agent off: a
      -- token that leaked must not stay good for seven days, so revoked_at
      -- may go from empty to set, once, with nothing else. Nothing else on
      -- the row.
      if tg_op = 'UPDATE' and (
           to_jsonb(new) - 'last_used_at' = to_jsonb(old) - 'last_used_at'
        or (old.revoked_at is null and new.revoked_at is not null
            and to_jsonb(new) - 'revoked_at' = to_jsonb(old) - 'revoked_at')
        or (old.oauth_client_id is not null
            and to_jsonb(new) - array['last_used_at', 'trust_tier']
              = to_jsonb(old) - array['last_used_at', 'trust_tier'])) then
        return new;
      end if;
      v_members := array[old.member_id, new.member_id];
      v_workspaces := array[old.workspace_id, new.workspace_id];
    when 'folders' then
      v_members := array[old.member_id, new.member_id];
      v_workspaces := array[old.workspace_id, new.workspace_id];
    when 'notes' then
      v_hives := array[old.hive_id, new.hive_id];
      v_members := array[old.member_id, new.member_id];
      v_workspaces := array[old.workspace_id, new.workspace_id];
      v_emptied := array['folder_id', 'written_by_agent'];
    when 'files' then
      v_hives := array[old.hive_id, new.hive_id];
      v_members := array[old.member_id, new.member_id];
      v_workspaces := array[old.workspace_id, new.workspace_id];
      v_emptied := array['note_id'];
    when 'note_versions' then
      v_notes := array[old.note_id, new.note_id];
      v_emptied := array['written_by_agent'];
    when 'note_entities' then
      v_notes := array[old.note_id, new.note_id];
      v_entities := array[old.entity_id, new.entity_id];
      v_emptied := array['confirmed_by'];
    when 'links' then
      v_hives := array[old.hive_id, new.hive_id];
      v_notes := array[old.from_note, new.from_note, old.to_note, new.to_note];
      v_emptied := array['ended_by'];
    when 'synthesis_pages' then
      v_hives := array[old.hive_id, new.hive_id];
      v_entities := array[old.entity_id, new.entity_id];
    else
      -- A table given this trigger without a rule here is refused every
      -- write, so it cannot be forgotten quietly.
      raise exception 'hive_frozen does not know %.%', tg_table_schema, tg_table_name;
  end case;

  -- Every hive the row reaches, by primary key.
  select array_agg(distinct x.id) into v_ids
    from (
      select unnest(v_hives) as id
      union all
      select m.hive_id from public.members m where m.id = any (v_members)
      union all
      select w.hive_id from public.workspaces w where w.id = any (v_workspaces)
      union all
      select n.hive_id from public.notes n where n.id = any (v_notes)
      union all
      select e.hive_id from public.entities e where e.id = any (v_entities)
    ) x
   where x.id is not null;

  -- Locked, so that a request to delete the hive and this write cannot pass
  -- each other (see the top of this file). A hive that is no longer there has
  -- no row here.
  for h in
    select x.id, x.delete_after, x.purging_at from public.hives x
     where x.id = any (v_ids)
     order by x.id
       for key share
  loop
    v_closing := v_closing or h.delete_after is not null;
    if h.purging_at is not null then
      v_purging := v_purging || h.id;
    end if;
  end loop;

  if v_closing and tg_op = 'DELETE' then
    -- A cascade: a parent of the row is already gone. A delete of its own
    -- always finds them all, by the foreign keys. For a delete every array
    -- holds the old row's values only.
    if exists (select 1 from unnest(v_hives) i
                where i is not null
                  and not exists (select 1 from public.hives p where p.id = i))
       or exists (select 1 from unnest(v_members) i
                   where i is not null
                     and not exists (select 1 from public.members p where p.id = i))
       or exists (select 1 from unnest(v_workspaces) i
                   where i is not null
                     and not exists (select 1 from public.workspaces p where p.id = i))
       or exists (select 1 from unnest(v_notes) i
                   where i is not null
                     and not exists (select 1 from public.notes p where p.id = i))
       or exists (select 1 from unnest(v_entities) i
                   where i is not null
                     and not exists (select 1 from public.entities p where p.id = i)) then
      return old;
    end if;
    -- A step of the erase: the server's role, and purge_hive's own marker
    -- for a hive this row belongs to, whose erase has begun (see the top).
    if current_setting('role', true) = 'service_role'
       and exists (select 1 from unnest(v_purging) i
                    where i::text = current_setting('hive.purging', true)) then
      return old;
    end if;
  elsif v_closing and tg_op = 'UPDATE' and cardinality(v_emptied) > 0 then
    -- A foreign key emptying a column because the row it pointed at is gone:
    -- nothing else changes, every changed column goes to null, and its
    -- parent is no longer there.
    -- notes.search is generated from the title and the body, which are
    -- compared themselves; in a before trigger the new row does not carry it
    -- yet.
    v_old := to_jsonb(old) - 'search';
    v_new := to_jsonb(new) - 'search';
    if v_old - v_emptied = v_new - v_emptied and v_old <> v_new then
      v_cascade := true;
      foreach v_column in array v_emptied loop
        if v_old -> v_column is distinct from v_new -> v_column then
          v_parent := (v_old ->> v_column)::uuid;
          v_there := case v_column
            when 'folder_id' then
              exists (select 1 from public.folders p where p.id = v_parent)
            when 'written_by_agent' then
              exists (select 1 from public.agents p where p.id = v_parent)
            when 'note_id' then
              exists (select 1 from public.notes p where p.id = v_parent)
            else
              exists (select 1 from public.members p where p.id = v_parent)
          end;
          if v_new ->> v_column is not null or v_parent is null or v_there then
            v_cascade := false;
          end if;
        end if;
      end loop;
      if v_cascade then
        return new;
      end if;
    end if;
  end if;

  if v_closing then
    raise exception 'this hive is being deleted';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end
$$;

-- Named to run after each table's other before-row triggers, so it sees the
-- row as they leave it (notes_before_write and files_before_insert set
-- hive_id). It does not depend on that: every route is looked at.
create trigger zz_hive_frozen before insert or update or delete on public.members
  for each row execute function public.hive_frozen();
create trigger zz_hive_frozen before insert or update or delete on public.workspaces
  for each row execute function public.hive_frozen();
create trigger zz_hive_frozen before insert or update or delete on public.agents
  for each row execute function public.hive_frozen();
create trigger zz_hive_frozen before insert or update or delete on public.folders
  for each row execute function public.hive_frozen();
create trigger zz_hive_frozen before insert or update or delete on public.notes
  for each row execute function public.hive_frozen();
create trigger zz_hive_frozen before insert or update or delete on public.note_versions
  for each row execute function public.hive_frozen();
create trigger zz_hive_frozen before insert or update or delete on public.files
  for each row execute function public.hive_frozen();
create trigger zz_hive_frozen before insert or update or delete on public.entities
  for each row execute function public.hive_frozen();
create trigger zz_hive_frozen before insert or update or delete on public.note_entities
  for each row execute function public.hive_frozen();
create trigger zz_hive_frozen before insert or update or delete on public.links
  for each row execute function public.hive_frozen();
create trigger zz_hive_frozen before insert or update or delete on public.synthesis_pages
  for each row execute function public.hive_frozen();
create trigger zz_hive_frozen before insert or update or delete on public.invitations
  for each row execute function public.hive_frozen();

-- TRUNCATE fires no row trigger. The API has no call for it; the right goes
-- anyway, from every table of a hive.
revoke truncate on
  public.hives, public.members, public.workspaces, public.agents,
  public.folders, public.notes, public.note_versions, public.files,
  public.entities, public.note_entities, public.links,
  public.synthesis_pages, public.invitations, public.notifications,
  public.audit_log
from anon, authenticated;

-- ---------------------------------------------------------- one hive per row

-- Stop, and change nothing, if a row already names parents in two hives: it
-- has to be looked at by a person, not carried along.
do $$
declare
  v_found text;
begin
  select string_agg(x.what || ': ' || x.n, ', ') into v_found
    from (
      select 'workspaces outside their member''s hive' as what, count(*) as n
        from public.workspaces w join public.members m on m.id = w.member_id
       where m.hive_id <> w.hive_id
      union all
      select 'agents on another member''s workspace', count(*)
        from public.agents a join public.workspaces w on w.id = a.workspace_id
       where w.member_id <> a.member_id
      union all
      select 'notes in a folder of another workspace', count(*)
        from public.notes n join public.folders f on f.id = n.folder_id
       where f.workspace_id <> n.workspace_id
      union all
      select 'note_entities across two hives', count(*)
        from public.note_entities ne
        join public.notes n on n.id = ne.note_id
        join public.entities e on e.id = ne.entity_id
       where n.hive_id <> e.hive_id
      union all
      select 'note_entities confirmed from another hive', count(*)
        from public.note_entities ne
        join public.notes n on n.id = ne.note_id
        join public.members m on m.id = ne.confirmed_by
       where m.hive_id <> n.hive_id
      union all
      select 'synthesis_pages outside their entity''s hive', count(*)
        from public.synthesis_pages s join public.entities e on e.id = s.entity_id
       where e.hive_id <> s.hive_id
    ) x
   where x.n > 0;
  if v_found is not null then
    raise exception 'rows that name two hives must be put right first (%)', v_found;
  end if;
end
$$;

-- A row names parents of one hive only, an entity stays in its hive, and who
-- wrote a note is not the writer's to say. Each check runs when the row is new
-- or when one of the columns it compares changes, so an update that touches
-- nothing of it (a foreign key emptying a column, a sign-in stamp) costs
-- nothing and is never refused here. A parent that does not exist is left to
-- the foreign key.
create function public.one_hive() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_note_hive uuid;
begin
  case tg_table_name
    when 'workspaces' then
      if (tg_op = 'INSERT' or new.hive_id <> old.hive_id or new.member_id <> old.member_id)
         and exists (select 1 from public.members m
                      where m.id = new.member_id and m.hive_id <> new.hive_id) then
        raise exception 'a workspace belongs to its member''s hive';
      end if;
    when 'agents' then
      if (tg_op = 'INSERT' or new.member_id <> old.member_id
          or new.workspace_id <> old.workspace_id)
         and exists (select 1 from public.workspaces w
                      where w.id = new.workspace_id and w.member_id <> new.member_id) then
        raise exception 'workspace does not belong to this member';
      end if;
    when 'notes' then
      if new.folder_id is not null
         and (tg_op = 'INSERT' or new.folder_id is distinct from old.folder_id
              or new.workspace_id <> old.workspace_id)
         and exists (select 1 from public.folders f
                      where f.id = new.folder_id and f.workspace_id <> new.workspace_id) then
        raise exception 'a note''s folder must be in the note''s own workspace';
      end if;
      -- Who wrote the note is stamped by notes_before_write when the content
      -- changes, and on a new note. An update that changes no content keeps
      -- what the row had, whatever it sends; only the foreign key empties
      -- it, when the agent is gone.
      if tg_op = 'UPDATE'
         and new.title = old.title and new.body = old.body
         and new.frontmatter = old.frontmatter
         and new.written_by_agent is distinct from old.written_by_agent then
        if exists (select 1 from public.agents a where a.id = old.written_by_agent) then
          new.written_by_agent := old.written_by_agent;
        else
          new.written_by_agent := null;
        end if;
      end if;
    when 'entities' then
      if tg_op = 'UPDATE' and new.hive_id <> old.hive_id then
        raise exception 'an entity stays in its hive';
      end if;
    when 'note_entities' then
      if tg_op = 'INSERT' or new.note_id <> old.note_id or new.entity_id <> old.entity_id
         or (new.confirmed_by is not null
             and new.confirmed_by is distinct from old.confirmed_by) then
        select n.hive_id into v_note_hive from public.notes n where n.id = new.note_id;
        if exists (select 1 from public.entities e
                    where e.id = new.entity_id and e.hive_id <> v_note_hive) then
          raise exception 'a note and an entity must be in the same hive';
        end if;
        if exists (select 1 from public.members m
                    where m.id = new.confirmed_by and m.hive_id <> v_note_hive) then
          raise exception 'a tag is confirmed by a member of the note''s hive';
        end if;
      end if;
    when 'synthesis_pages' then
      if (tg_op = 'INSERT' or new.hive_id <> old.hive_id or new.entity_id <> old.entity_id)
         and exists (select 1 from public.entities e
                      where e.id = new.entity_id and e.hive_id <> new.hive_id) then
        raise exception 'a synthesis page belongs to its entity''s hive';
      end if;
    else
      raise exception 'one_hive does not know %.%', tg_table_schema, tg_table_name;
  end case;
  return new;
end
$$;

-- After the freeze, so a closing hive answers with the freeze's own words.
create trigger zzz_one_hive before insert or update on public.workspaces
  for each row execute function public.one_hive();
create trigger zzz_one_hive before insert or update on public.agents
  for each row execute function public.one_hive();
create trigger zzz_one_hive before insert or update on public.notes
  for each row execute function public.one_hive();
create trigger zzz_one_hive before insert or update on public.note_entities
  for each row execute function public.one_hive();
create trigger zzz_one_hive before update on public.entities
  for each row execute function public.one_hive();
create trigger zzz_one_hive before insert or update on public.synthesis_pages
  for each row execute function public.one_hive();

-- ------------------------------------------------------------ stored objects

-- As in 20261122063919_file_storage.sql, and not into a closing hive: neither
-- the workspace's hive nor its member's. create or replace keeps its grants.
create or replace function public.can_write_file(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select not public.jwt_is_self_hosted() and exists (
    select 1 from public.workspaces w
    where w.member_id in (select public.my_member_ids())
      and public.agent_write_ok(w.id)
      and p_name like w.member_id::text || '/' || w.id::text || '/%'
      and not public.hive_is_closing(w.hive_id)
      and not public.hive_is_closing(
            (select m.hive_id from public.members m where m.id = w.member_id))
  )
$$;

-- The caller may remove the stored object at this path: a person, under one
-- of their own workspaces, in a hive that is not closing. An app pass has no
-- workspaces (my_member_ids is empty for it).
create function public.can_delete_file(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.jwt_agent_id() is null and exists (
    select 1 from public.workspaces w
    where w.member_id in (select public.my_member_ids())
      and p_name like w.member_id::text || '/' || w.id::text || '/%'
      and not public.hive_is_closing(w.hive_id)
      and not public.hive_is_closing(
            (select m.hive_id from public.members m where m.id = w.member_id))
  )
$$;

-- What it asked before, and can_delete_file.
alter policy hive_files_delete on storage.objects
  using (bucket_id = 'files'
         and public.owns_file_path(name)
         and public.jwt_agent_id() is null
         and public.can_delete_file(name));

-- ------------------------------------------------- asking and cancelling

-- Who may delete this hive: its owner, signed in as a person. Answers the
-- caller's member in the hive or raises. The database's own: the three
-- functions below call it first, so they refuse the same callers in the same
-- order with the same words.
create function public.hive_deletion_owner(p_hive uuid) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_member uuid;
  v_role public.member_role;
begin
  if public.jwt_oauth_client() is not null then
    raise exception 'an app pass cannot do this';
  end if;
  if v_uid is null or public.jwt_agent_id() is not null or public.jwt_is_self_hosted() then
    raise exception 'only a person can delete a hive';
  end if;
  -- Not a member, or no such hive: the same answer.
  select m.id, m.role into v_member, v_role from public.members m
   where m.hive_id = p_hive and m.user_id = v_uid;
  if v_member is null then
    raise exception 'hive not found';
  end if;
  if v_role <> 'owner' then
    raise exception 'only the owner can delete a hive';
  end if;
  return v_member;
end
$$;

-- What the hive holds, for the sentence shown before it is deleted. Each
-- count reads by an index on hive_id.
create function public.hive_deletion_preview(p_hive uuid)
returns table (members integer, notes integer, files integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.hive_deletion_owner(p_hive);
  return query
    select (select count(*)::integer from public.members m where m.hive_id = p_hive),
           (select count(*)::integer from public.notes n where n.hive_id = p_hive),
           (select count(*)::integer from public.files f where f.hive_id = p_hive);
end
$$;

-- Mark the hive for deletion. Returns the day it will be erased.
create function public.request_hive_deletion(p_hive uuid, p_name text)
returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare
  v_space constant text := E' \t\n\r\f\x0B';
  v_me uuid := public.hive_deletion_owner(p_hive);
  h public.hives;
  v_after timestamptz;
begin
  -- Only the owner gets this far, so only the owner can hold the lock.
  select * into h from public.hives x where x.id = p_hive for update;
  if h.id is null then
    raise exception 'hive not found';
  end if;
  -- The name as typed, without the white space around it. A hive made before
  -- names were stored trimmed is compared the same way.
  if btrim(coalesce(p_name, ''), v_space) <> btrim(h.name, v_space) then
    raise exception 'that is not the name of this hive';
  end if;
  if h.delete_after is not null then
    return h.delete_after;
  end if;
  update public.hives
     set closing_at = now(),
         delete_after = now() + interval '7 days',
         closing_by = (select auth.uid())
   where id = p_hive
   returning delete_after into v_after;
  insert into public.audit_log (hive_id, member_id, action, detail)
    values (p_hive, v_me, 'hive.deletion_requested',
            jsonb_build_object('delete_after', v_after));
  return v_after;
end
$$;

-- Take the mark away. The freeze ends with it.
create function public.cancel_hive_deletion(p_hive uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public.hive_deletion_owner(p_hive);
  h public.hives;
begin
  -- The same lock begin_hive_purge takes: whichever comes second sees what
  -- the first one did.
  select * into h from public.hives x where x.id = p_hive for update;
  if h.id is null then
    raise exception 'hive not found';
  end if;
  if h.delete_after is null then
    raise exception 'this hive is not being deleted';
  end if;
  -- Past the point of no return: its stored files may already be gone.
  if h.purging_at is not null then
    raise exception 'this hive is already being erased';
  end if;
  update public.hives
     set closing_at = null, delete_after = null, closing_by = null
   where id = p_hive;
  insert into public.audit_log (hive_id, member_id, action, detail)
    values (p_hive, v_me, 'hive.deletion_cancelled',
            jsonb_build_object('delete_after', h.delete_after));
end
$$;

-- ----------------------------------------------------------------- the erase

-- Outside every hive, so it has no foreign key: it is what is left. Written
-- when the erase begins, with the counts as they are then; purged_at is set
-- when the hive's row is gone.
create table public.deleted_hives (
  hive_id uuid primary key,
  name text not null,
  requested_by uuid,
  requested_at timestamptz,
  purged_at timestamptz,
  members integer not null,
  notes integer not null,
  files integer not null
);
-- No policy: row-level security refuses everyone it binds. And no right at
-- all for the API's roles, whatever the schema's defaults gave them.
alter table public.deleted_hives enable row level security;
revoke all on public.deleted_hives from anon, authenticated;
grant all on public.deleted_hives to service_role;

-- The hives whose day has come: those never attempted first, then the ones
-- attempted longest ago.
create function public.hives_due_for_purge() returns table (id uuid)
language sql stable security definer set search_path = '' as $$
  select h.id from public.hives h
   where h.delete_after is not null and h.delete_after <= now()
   order by h.purging_at nulls first, h.delete_after, h.id
   limit 20
$$;

-- The point of no return. The date is checked here, under a lock on the
-- hive's row, whatever the caller read before: a cancel that came first wins,
-- and one that comes after is refused.
create function public.begin_hive_purge(p_hive uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  h public.hives;
begin
  select * into h from public.hives x where x.id = p_hive for update;
  if h.id is null then
    raise exception 'hive not found';
  end if;
  if h.delete_after is null or h.delete_after > now() then
    raise exception 'this hive is not due';
  end if;
  -- Every attempt is stamped: the newest attempt goes to the back of the
  -- queue.
  update public.hives set purging_at = now() where id = p_hive;
  if h.purging_at is null then
    insert into public.deleted_hives
      (hive_id, name, requested_by, requested_at, members, notes, files)
    values (
      h.id, h.name, h.closing_by, h.closing_at,
      (select count(*)::integer from public.members m where m.hive_id = p_hive),
      (select count(*)::integer from public.notes n where n.hive_id = p_hive),
      (select count(*)::integer from public.files f where f.hive_id = p_hive));
  end if;
end
$$;

-- The stored objects of a hive that is being erased: everything in the
-- 'files' bucket under one of its members (a path starts with the member's
-- id), whether or not a files row names it. By name, after p_after, at most
-- 1,000. Compared byte by byte (collate "C") throughout, so the pages follow
-- one order whatever the column's own collation: '0' is the character after
-- '/', so the range is exactly the names that start with "<member>/".
create function public.hive_object_paths(p_hive uuid, p_after text, p_limit integer)
returns table (name text)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_purging timestamptz;
begin
  select h.purging_at into v_purging from public.hives h where h.id = p_hive;
  if not found then
    raise exception 'hive not found';
  end if;
  if v_purging is null then
    raise exception 'this hive is not due';
  end if;
  return query
    select o.name::text
      from public.members m
      join storage.objects o
        on o.bucket_id = 'files'
       and o.name collate "C" >= (m.id::text || '/') collate "C"
       and o.name collate "C" < (m.id::text || '0') collate "C"
     where m.hive_id = p_hive
       and o.name collate "C" > coalesce(p_after, '') collate "C"
     order by o.name collate "C"
     limit least(greatest(p_limit, 1), 1000);
end
$$;

-- What the steps of an erase find a hive's rows by. The foreign keys read
-- by them as well.
create index links_hive_idx on public.links (hive_id);
create index workspaces_hive_idx on public.workspaces (hive_id);
create index invitations_hive_idx on public.invitations (hive_id);
create index notifications_hive_idx on public.notifications (hive_id);
create index agents_member_idx on public.agents (member_id);

-- One step of the erase, within a budget of rows. False when the budget is
-- used up, true when the hive is gone. Only after begin_hive_purge.
--
-- The tables are emptied in an order in which no delete cascades: a table is
-- reached only when every table that points at it is empty for this hive,
-- because each step either empties its table or uses up the budget and ends
-- the call. So a call deletes the rows it counts and no others, and the
-- delete of the hive's row, at the end, cascades into nothing.
create function public.purge_hive(p_hive uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  c_budget constant integer := 2000;
  -- An agent, a workspace or a member costs this many rows of the budget:
  -- their foreign keys read tables that have no index on the column.
  c_heavy constant integer := 20;
  h public.hives;
  v_left integer := c_budget;
  v_step integer;
  v_cost integer;
  v_limit integer;
  v_n integer;
begin
  select * into h from public.hives x where x.id = p_hive for update;
  if h.id is null then
    raise exception 'hive not found';
  end if;
  if h.purging_at is null or h.delete_after is null or h.delete_after > now() then
    raise exception 'this hive is not due';
  end if;
  -- What lets these deletes past the freeze, for this hive and this
  -- transaction only (see hive_frozen).
  perform set_config('hive.purging', p_hive::text, true);

  for v_step in 1..15 loop
    -- How many rows of this table the rest of the budget pays for.
    v_cost := case when v_step >= 13 then c_heavy else 1 end;
    v_limit := greatest(v_left / v_cost, 1);
    v_n := 0;
    case v_step
      when 1 then
        delete from public.note_versions d
         where (d.note_id, d.version) in (
           select x.note_id, x.version
             from public.note_versions x join public.notes n on n.id = x.note_id
            where n.hive_id = p_hive
            limit v_limit);
        get diagnostics v_n = row_count;
      when 2 then
        -- By the note, then by the entity: a tag left across two hives is in
        -- one of the two.
        delete from public.note_entities d
         where (d.note_id, d.entity_id) in (
           select x.note_id, x.entity_id
             from public.note_entities x join public.notes n on n.id = x.note_id
            where n.hive_id = p_hive
            limit v_limit);
        get diagnostics v_n = row_count;
      when 3 then
        delete from public.note_entities d
         where (d.note_id, d.entity_id) in (
           select x.note_id, x.entity_id
             from public.note_entities x join public.entities e on e.id = x.entity_id
            where e.hive_id = p_hive
            limit v_limit);
        get diagnostics v_n = row_count;
      when 4 then
        delete from public.links d
         where d.id in (select x.id from public.links x
                         where x.hive_id = p_hive limit v_limit);
        get diagnostics v_n = row_count;
      when 5 then
        delete from public.files d
         where d.id in (select x.id from public.files x
                         where x.hive_id = p_hive limit v_limit);
        get diagnostics v_n = row_count;
      when 6 then
        delete from public.synthesis_pages d
         where d.entity_id in (
           select x.entity_id
             from public.synthesis_pages x join public.entities e on e.id = x.entity_id
            where e.hive_id = p_hive
            limit v_limit);
        get diagnostics v_n = row_count;
      when 7 then
        -- Versions, tags, links and file rows are gone: nothing follows a
        -- note.
        delete from public.notes d
         where d.id in (select x.id from public.notes x
                         where x.hive_id = p_hive limit v_limit);
        get diagnostics v_n = row_count;
      when 8 then
        delete from public.folders d
         where d.id in (
           select x.id
             from public.folders x join public.workspaces w on w.id = x.workspace_id
            where w.hive_id = p_hive
            limit v_limit);
        get diagnostics v_n = row_count;
      when 9 then
        delete from public.entities d
         where d.id in (select x.id from public.entities x
                         where x.hive_id = p_hive limit v_limit);
        get diagnostics v_n = row_count;
      when 10 then
        delete from public.invitations d
         where d.id in (select x.id from public.invitations x
                         where x.hive_id = p_hive limit v_limit);
        get diagnostics v_n = row_count;
      when 11 then
        delete from public.notifications d
         where d.id in (select x.id from public.notifications x
                         where x.hive_id = p_hive limit v_limit);
        get diagnostics v_n = row_count;
      when 12 then
        -- After the notes and the folders, whose triggers write here when a
        -- person is signed in. Before the agents and the members, whose
        -- foreign keys would otherwise empty a column of every row.
        delete from public.audit_log d
         where d.id in (select x.id from public.audit_log x
                         where x.hive_id = p_hive limit v_limit);
        get diagnostics v_n = row_count;
      when 13 then
        delete from public.agents d
         where d.id in (
           select x.id
             from public.agents x join public.members m on m.id = x.member_id
            where m.hive_id = p_hive
            limit v_limit);
        get diagnostics v_n = row_count;
      when 14 then
        delete from public.workspaces d
         where d.id in (select x.id from public.workspaces x
                         where x.hive_id = p_hive
                         limit v_limit);
        get diagnostics v_n = row_count;
      when 15 then
        -- The members are what the stored objects are found by (a path
        -- starts with a member's id), so they stay, and the hive with them,
        -- until the purge function has removed every object. The same range
        -- as hive_object_paths. What this call removed so far is kept; a
        -- call that could do nothing else says why.
        if exists (
             select 1
               from public.members m
               join storage.objects o
                 on o.bucket_id = 'files'
                and o.name collate "C" >= (m.id::text || '/') collate "C"
                and o.name collate "C" < (m.id::text || '0') collate "C"
              where m.hive_id = p_hive) then
          if v_left < c_budget then
            perform set_config('hive.purging', '', true);
            return false;
          end if;
          raise exception 'stored objects remain';
        end if;
        delete from public.members d
         where d.id in (select x.id from public.members x
                         where x.hive_id = p_hive
                         limit v_limit);
        get diagnostics v_n = row_count;
    end case;
    -- As many as the budget allowed: there may be more, and the tables
    -- after this one must wait for it to be empty.
    if v_n >= v_limit then
      perform set_config('hive.purging', '', true);
      return false;
    end if;
    v_left := v_left - v_n * v_cost;
  end loop;

  -- Every table is empty for this hive. Its row is gone before anything left
  -- under it is reached (a row put there since, or one left across two
  -- hives), so the freeze lets that go too.
  delete from public.hives where id = p_hive;
  update public.deleted_hives set purged_at = now() where hive_id = p_hive;
  perform set_config('hive.purging', '', true);
  return true;
end
$$;

-- ------------------------------------------------------------------ grants

-- The database's own: a trigger function is never called by hand, and the
-- other two are called only by functions that run as their owner.
revoke all on function
  public.hive_frozen(),
  public.one_hive(),
  public.hive_is_closing(uuid),
  public.hive_deletion_owner(uuid)
from public, anon, authenticated;

-- For signed-in callers; each decides for itself who that may be.
-- can_delete_file is asked by the delete policy on storage.objects.
revoke all on function
  public.can_delete_file(text),
  public.hive_deletion_preview(uuid),
  public.request_hive_deletion(uuid, text),
  public.cancel_hive_deletion(uuid)
from public, anon;
grant execute on function
  public.can_delete_file(text),
  public.hive_deletion_preview(uuid),
  public.request_hive_deletion(uuid, text),
  public.cancel_hive_deletion(uuid)
to authenticated;

-- The server's.
revoke all on function
  public.hives_due_for_purge(),
  public.begin_hive_purge(uuid),
  public.hive_object_paths(uuid, text, integer),
  public.purge_hive(uuid)
from public, anon, authenticated;
grant execute on function
  public.hives_due_for_purge(),
  public.begin_hive_purge(uuid),
  public.hive_object_paths(uuid, text, integer),
  public.purge_hive(uuid)
to service_role;
