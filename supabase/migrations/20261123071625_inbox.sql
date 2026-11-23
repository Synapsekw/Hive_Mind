-- 20261123071625_inbox.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp). Do not hand-edit
-- the version, and never edit a migration that has shipped.
--
-- What this migration does:
--   The inbox: what waits for a person's own decision in one hive.
--
--   inbox(hive)        the newest 100 link proposals the caller has not answered
--                      and the newest 100 of the caller's held notes, with totals
--   inbox_count(hive)  the two totals added, for the rail
--
--   About the other owner's note a link item says what map_graph already says
--   of a locked dot: the owner's name and the note's topic. The title only when
--   the caller can already read the note. Never the body, the path or the id.
--   A link with a held note on either side is left out until it is released.
--   People only, like map_graph. Both are security definer, so every read is
--   filtered by p_hive and by the caller's own member id explicitly.
--
--   No change to respond_to_link, to any policy or to who can read what.

create index links_proposed_idx on public.links (hive_id) where status = 'proposed';
create index notes_held_idx on public.notes (member_id) where quarantined;

create function public.inbox(p_hive uuid) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_cap constant integer := 100;
  v_me uuid;
  v_links jsonb;
  v_links_total bigint;
  v_held jsonb;
  v_held_total bigint;
begin
  -- People only. A self-hosted claim without an agent id is refused as well.
  if public.jwt_agent_id() is not null or public.jwt_is_self_hosted() then
    raise exception 'inbox is for people';
  end if;
  select m.id into v_me from public.members m
   where m.hive_id = p_hive and m.user_id = (select auth.uid());
  if v_me is null then
    raise exception 'not a member of this hive';
  end if;

  -- Proposed links with one note of the caller's whose side is not accepted.
  -- A proposed link always has two different owners (two notes of one owner
  -- are accepted at once), so `mine` matches one row per link.
  -- Readability is decided with the internal _can_read_note, as in map_graph:
  -- `theirs` is a stored row of this hive.
  with waiting as (
    select l.id, l.tier, l.created_at,
           (mine.id = l.from_note) as from_mine,
           (case when mine.id = l.from_note then l.to_accepted_at
                 else l.from_accepted_at end) is not null as they_accepted,
           mine.id as mine_id, mine.title as mine_title, mine.path as mine_path,
           mine.workspace_id as mine_ws,
           o.display_name as their_name,
           public.note_topic(theirs.path) as their_topic,
           case when public._can_read_note(theirs) then theirs.title end as their_title,
           count(*) over () as total
      from public.links l
      join public.notes mine
        on mine.id in (l.from_note, l.to_note)
       and mine.member_id = v_me and mine.hive_id = p_hive
      join public.notes theirs
        on theirs.id = case when mine.id = l.from_note then l.to_note else l.from_note end
       and theirs.hive_id = p_hive
      join public.members o on o.id = theirs.member_id and o.hive_id = p_hive
     where l.hive_id = p_hive
       and l.status = 'proposed'
       and (case when mine.id = l.from_note then l.from_accepted_at
                 else l.to_accepted_at end) is null
       and not mine.quarantined
       and not theirs.quarantined
     order by l.created_at desc, l.id
     limit v_cap
  )
  select coalesce(max(w.total), 0),
         coalesce(jsonb_agg(jsonb_build_object(
           'id', w.id,
           'tier', w.tier,
           'created_at', w.created_at,
           'proposed_by', case when w.from_mine then 'mine'::text else 'theirs'::text end,
           'they_accepted', w.they_accepted,
           'mine', jsonb_build_object(
             'id', w.mine_id, 'title', w.mine_title, 'path', w.mine_path,
             'workspace_id', w.mine_ws),
           'theirs', jsonb_build_object(
             'member_name', w.their_name, 'topic', w.their_topic, 'title', w.their_title)
         ) order by w.created_at desc, w.id), '[]'::jsonb)
    into v_links_total, v_links
    from waiting w;

  -- The caller's own held notes. The agent is named only when it is theirs.
  with held as (
    select n.id, n.title, n.path, n.workspace_id, n.updated_at, a.name as agent_name,
           count(*) over () as total
      from public.notes n
      left join public.agents a on a.id = n.written_by_agent and a.member_id = v_me
     where n.member_id = v_me and n.hive_id = p_hive and n.quarantined
     order by n.updated_at desc, n.id
     limit v_cap
  )
  select coalesce(max(h.total), 0),
         coalesce(jsonb_agg(jsonb_build_object(
           'id', h.id, 'title', h.title, 'path', h.path,
           'workspace_id', h.workspace_id, 'agent_name', h.agent_name,
           'updated_at', h.updated_at
         ) order by h.updated_at desc, h.id), '[]'::jsonb)
    into v_held_total, v_held
    from held h;

  return jsonb_build_object(
    'links', v_links, 'links_total', v_links_total,
    'held', v_held, 'held_total', v_held_total);
end
$$;

-- The same two conditions as inbox, counted without building the lists.
create function public.inbox_count(p_hive uuid) returns integer
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_me uuid;
begin
  if public.jwt_agent_id() is not null or public.jwt_is_self_hosted() then
    raise exception 'inbox is for people';
  end if;
  select m.id into v_me from public.members m
   where m.hive_id = p_hive and m.user_id = (select auth.uid());
  if v_me is null then
    raise exception 'not a member of this hive';
  end if;
  return (
    select count(*)
      from public.links l
      join public.notes mine
        on mine.id in (l.from_note, l.to_note)
       and mine.member_id = v_me and mine.hive_id = p_hive
      join public.notes theirs
        on theirs.id = case when mine.id = l.from_note then l.to_note else l.from_note end
       and theirs.hive_id = p_hive
      join public.members o on o.id = theirs.member_id and o.hive_id = p_hive
     where l.hive_id = p_hive
       and l.status = 'proposed'
       and (case when mine.id = l.from_note then l.from_accepted_at
                 else l.to_accepted_at end) is null
       and not mine.quarantined
       and not theirs.quarantined
  ) + (
    select count(*) from public.notes n
     where n.member_id = v_me and n.hive_id = p_hive and n.quarantined
  );
end
$$;

revoke all on function public.inbox(uuid), public.inbox_count(uuid) from public, anon;
grant execute on function public.inbox(uuid), public.inbox_count(uuid) to authenticated;
