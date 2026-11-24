-- 20261124185153_topics_view.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp). Do not hand-edit
-- the version, and never edit a migration that has shipped.
--
-- Topics, part 2: the map carries them.
--
--   - Two more kinds of topic: partner and solution.
--   - public.topic_rank(kind): the order the app shows kinds in (client,
--     partner, project, vendor, product, solution, person, subject). It
--     compares text, so it names the two new values without using them as enum
--     literals, which Postgres forbids in the transaction that adds them.
--   - public.map_graph: replaced, identical but for topics. Each node gains
--     `topics`: the ids of the note's attached topics in this hive, strongest
--     first (confidence, then kind, then name), at most five. A locked note
--     carries none, and neither does a file. The answer gains a top-level
--     `topics`: { id, name, kind } for every topic of the hive, by kind then
--     name. A topic's name is the hive's to read (entities_select), so the list
--     leaks nothing a member could not already select. The per-note read goes
--     by the primary key of note_entities (note_id, entity_id).
--
-- The function is still people only: an app pass, an agent and a self-hosted
-- claim are refused as before.

alter type public.entity_type add value if not exists 'partner';
alter type public.entity_type add value if not exists 'solution';

create function public.topic_rank(p_kind public.entity_type) returns integer
language sql immutable set search_path = '' as $$
  select case p_kind::text
    when 'client' then 1 when 'partner' then 2 when 'project' then 3
    when 'vendor' then 4 when 'product' then 5 when 'solution' then 6
    when 'person' then 7 else 8 end
$$;
revoke all on function public.topic_rank(public.entity_type) from public, anon, authenticated;

-- ---------------------------------------------------------------- map_graph

create or replace function public.map_graph(p_hive uuid) returns jsonb
language plpgsql stable security definer
set search_path = ''
set plan_cache_mode = force_custom_plan
as $$
declare
  v_cap constant integer := 5000;
  v_me uuid;
  v_total bigint;
  v_nodes jsonb;
  v_open uuid[];
  v_members jsonb;
  v_agents jsonb;
  v_links jsonb;
  v_topics jsonb;
begin
  if public.jwt_oauth_client() is not null then
    raise exception 'an app pass cannot do this';
  end if;
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
    select n.id, 'note'::text as kind, n.updated_at, null::uuid as file_note
      from public.notes n
     where n.hive_id = p_hive
       and (n.member_id = v_me or not n.quarantined)
    union all
    select f.id, 'file'::text, f.created_at, fn.id
      from public.files f
      left join public.notes fn on fn.id = f.note_id and fn.hive_id = p_hive
     where f.hive_id = p_hive
       and (f.member_id = v_me or fn.id is null or not fn.quarantined)
  ),
  picked as (
    select i.*, count(*) over () as total
      from items i
     order by i.updated_at desc, i.id
     limit v_cap
  ),
  kept as materialized (
    select p.id, p.kind, p.updated_at, n.created_at, p.total,
           public.note_topic(n.path) as topic,
           n.member_id,
           public._can_read_note(n) as readable,
           n.title, n.path, n.workspace_id,
           (n.written_by_agent is not null) as by_agent,
           case when n.member_id = v_me then n.written_by_agent end as agent_id,
           null::uuid as note_id,
           (select coalesce(jsonb_agg(x.entity_id order by x.confidence desc, x.rank, x.name), '[]'::jsonb)
              from (select ne.entity_id, ne.confidence,
                           public.topic_rank(e.type) as rank, e.canonical_name as name
                      from public.note_entities ne
                      join public.entities e on e.id = ne.entity_id and e.hive_id = p_hive
                     where ne.note_id = n.id and ne.detached_at is null
                     order by ne.confidence desc, public.topic_rank(e.type), e.canonical_name
                     limit 5) x) as topics
      from picked p
      join public.notes n on n.id = p.id and n.hive_id = p_hive
     where p.kind = 'note'
    union all
    select p.id, p.kind, p.updated_at, f.created_at, p.total,
           case when fn.id is null then 'Files' else public.note_topic(fn.path) end,
           f.member_id,
           (f.member_id = v_me or (fn.id is not null and public._can_read_note(fn))),
           f.name, f.storage_path, f.workspace_id,
           false,
           null::uuid,
           f.note_id,
           '[]'::jsonb
      from picked p
      join public.files f on f.id = p.id and f.hive_id = p_hive
      left join public.notes fn on fn.id = p.file_note and fn.hive_id = p_hive
     where p.kind = 'file'
  )
  select coalesce(max(k.total), 0),
         coalesce(jsonb_agg(jsonb_build_object(
           'id', k.id,
           'kind', k.kind,
           'topic', k.topic,
           'member_id', k.member_id,
           'updated_at', k.updated_at,
           'created_at', k.created_at,
           'locked', not k.readable,
           'title', case when k.readable then k.title end,
           'path', case when k.readable then k.path end,
           'workspace_id', case when k.readable then k.workspace_id end,
           'by_agent', case when k.readable then k.by_agent end,
           'agent_id', case when k.readable then k.agent_id end,
           'note_id', case when k.readable then k.note_id end,
           'topics', case when k.readable then k.topics else '[]'::jsonb end
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
     and a.revoked_at is null
     and (a.expires_at is null or a.expires_at > now());

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

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', e.id, 'name', e.canonical_name, 'kind', e.type
         ) order by public.topic_rank(e.type), e.canonical_name, e.id), '[]'::jsonb)
    into v_topics
    from public.entities e
   where e.hive_id = p_hive;

  return jsonb_build_object(
    'members', v_members,
    'agents', v_agents,
    'nodes', v_nodes,
    'links', v_links,
    'topics', v_topics,
    'truncated', v_total > v_cap);
end
$$;

revoke all on function
  public.map_graph(uuid)
from public, anon;
grant execute on function
  public.map_graph(uuid)
to authenticated;
