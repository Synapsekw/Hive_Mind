-- 20261122083415_map_graph.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp). Do not hand-edit
-- the version, and never edit a migration that has shipped.
--
-- What this migration does:
--   Adds public.map_graph(hive): one call that returns the hive's map for the
--   person asking. Every note and file of the hive is a node. What the caller
--   may read comes back in full; anything else in the hive comes back as a
--   locked stub (id, kind, topic, owner, time) with the other keys null.
--   Someone else's quarantined note, and a file attached to it, are left out.
--   Bodies and frontmatter are never returned. Links are those links_select
--   already shows (one end is the caller's own), and only accepted ones.
--
--   The function is security definer, so row-level security does not apply
--   inside it: every read below is filtered by p_hive and decided explicitly
--   with can_read_note, the same test the notes_select policy uses.
--
--   Also adds public.note_topic(path) and an index on files (hive_id).

create index files_hive_idx on public.files (hive_id);

-- A note's folder cut to its first two segments; 'General' at the root.
create function public.note_topic(p_path text) returns text
language sql immutable set search_path = '' as $$
  select coalesce(
    nullif(array_to_string(t.s[1:least(2, cardinality(t.s) - 1)], '/'), ''),
    'General')
  from (select array_remove(string_to_array(coalesce(p_path, ''), '/'), '') as s) t
$$;

create function public.map_graph(p_hive uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_cap constant integer := 5000;
  v_me uuid;
  v_total bigint;
  v_nodes jsonb;
  v_open uuid[];
  v_members jsonb;
  v_agents jsonb;
  v_links jsonb;
begin
  -- People only. A self-hosted claim without an agent id is refused as well.
  if public.jwt_agent_id() is not null or public.jwt_is_self_hosted() then
    raise exception 'map_graph is for people';
  end if;
  select m.id into v_me from public.members m
   where m.hive_id = p_hive and m.user_id = (select auth.uid());
  if v_me is null then
    raise exception 'not a member of this hive';
  end if;

  with items as (
    select n.id, 'note'::text as kind, public.note_topic(n.path) as topic,
           n.member_id, n.updated_at,
           public.can_read_note(n) as readable,
           n.title, n.path, n.workspace_id,
           (n.written_by_agent is not null) as by_agent,
           case when n.member_id = v_me then n.written_by_agent end as agent_id,
           null::uuid as note_id
      from public.notes n
     where n.hive_id = p_hive
       and (n.member_id = v_me or not n.quarantined)
    union all
    select f.id, 'file'::text,
           case when fn.id is null then 'Files' else public.note_topic(fn.path) end,
           f.member_id, f.created_at,
           (f.member_id = v_me or (fn.id is not null and public.can_read_note(fn))),
           f.name, f.storage_path, f.workspace_id,
           false,
           null::uuid,
           f.note_id
      from public.files f
      left join public.notes fn on fn.id = f.note_id and fn.hive_id = p_hive
     where f.hive_id = p_hive
       and (f.member_id = v_me or fn.id is null or not fn.quarantined)
  ),
  kept as (
    select i.*, count(*) over () as total
      from items i
     order by i.updated_at desc, i.id
     limit v_cap
  )
  select coalesce(max(k.total), 0),
         coalesce(jsonb_agg(jsonb_build_object(
           'id', k.id,
           'kind', k.kind,
           'topic', k.topic,
           'member_id', k.member_id,
           'updated_at', k.updated_at,
           'locked', not k.readable,
           'title', case when k.readable then k.title end,
           'path', case when k.readable then k.path end,
           'workspace_id', case when k.readable then k.workspace_id end,
           'by_agent', case when k.readable then k.by_agent end,
           'agent_id', case when k.readable then k.agent_id end,
           'note_id', case when k.readable then k.note_id end
         ) order by k.updated_at desc, k.id), '[]'::jsonb),
         coalesce(array_agg(k.id) filter (where k.readable and k.kind = 'note'), '{}')
    into v_total, v_nodes, v_open
    from kept k;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', m.id,
           'display_name', m.display_name,
           'is_me', m.id = v_me
         ) order by m.created_at, m.id), '[]'::jsonb)
    into v_members
    from public.members m
   where m.hive_id = p_hive;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', a.id,
           'member_id', a.member_id,
           'provider', a.provider,
           'trust_tier', a.trust_tier,
           'last_used_at', a.last_used_at,
           'name', case when a.member_id = v_me then a.name end
         ) order by a.created_at, a.id), '[]'::jsonb)
    into v_agents
    from public.agents a
    join public.members m on m.id = a.member_id
   where m.hive_id = p_hive
     and a.revoked_at is null;

  -- As narrow as links_select: one of the two notes is the caller's own.
  -- Both ends must also be readable nodes on this map.
  select coalesce(jsonb_agg(jsonb_build_object(
           'from', l.from_note,
           'to', l.to_note,
           'tier', l.tier,
           'score', l.score
         ) order by l.created_at, l.id), '[]'::jsonb)
    into v_links
    from public.links l
   where l.hive_id = p_hive
     and l.status = 'accepted'
     and exists (select 1 from public.notes n
                  where n.hive_id = p_hive
                    and n.id in (l.from_note, l.to_note)
                    and n.member_id = v_me)
     and l.from_note = any (v_open)
     and l.to_note = any (v_open);

  return jsonb_build_object(
    'members', v_members,
    'agents', v_agents,
    'nodes', v_nodes,
    'links', v_links,
    'truncated', v_total > v_cap);
end
$$;

revoke all on function public.map_graph(uuid) from public, anon;
grant execute on function public.map_graph(uuid) to authenticated;
