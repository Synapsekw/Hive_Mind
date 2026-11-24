-- 20261124173204_topics.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp). Do not hand-edit
-- the version, and never edit a migration that has shipped.
--
-- What this migration does:
--   Topics. A topic is a row of public.entities (shown as "topic" in the app);
--   a note is attached to a topic by a row of public.note_entities. Both
--   tables and their policies exist since the first migration and were empty.
--   The app is about to fill them, so this adds what they need.
--
--   - entity_type gains 'vendor' and 'subject'. Neither is used in this file.
--   - topic_rules(), one trigger function, attached to public.entities as
--     zzzz_topic_rules, before insert and before an update of the name or the
--     aliases, for each row. It binds every writer alike.
--       The name is trimmed of white space at the ends and stored that way;
--       it is 1 to 80 characters. Refusals: 'a topic needs a name',
--       'that topic name is too long'.
--       Each alias is trimmed; an empty one and a repeated one are dropped;
--       one over 80 characters is refused with 'that topic alias is too
--       long'; more than 20 with 'a topic has at most 20 aliases'.
--       A hive has at most 2,000 topics: one more is refused with
--       'this hive already has 2000 topics'. The count is made under a lock
--       for the hive, held until the transaction ends. A caller that comes
--       through the API (the session's role is anon or authenticated) and
--       does not own the hive is not counted for: entities_insert refuses
--       that row anyway, and the answer then says nothing about the hive.
--     It runs after zz_hive_frozen and zzz_one_hive, by its name, so a hive
--     that is being deleted still answers 'this hive is being deleted'.
--   - note_entities gains detached_at: null while the note is attached. A row
--     that is detached stays, so the pair cannot be attached again by an
--     insert: the note's owner said no, and the next run respects it.
--   - note_entities_update: the note's owner, signed in as a person (never an
--     agent; an app pass is refused by note_entities_no_app as everywhere),
--     may update a row, and the column grant lets only detached_at be
--     written. Insert and select are unchanged.
--   - note_entities_delete gains one condition: the identity must carry no
--     agent_id claim. The note's owner as a person may still delete a pair;
--     an agent acting as that owner may not (an app pass is refused by
--     note_entities_no_app as everywhere). A detached row has to stay: it is
--     how the next run knows the person said no, and an agent that could
--     delete it would let the note be attached again against that decision.
--     The old condition (the note's owner) is kept exactly.
--
--   Nobody reads anything they could not read before: a topic's name is the
--   hive's (entities_select), and a note's topics follow the note
--   (note_entities_select). The count reads entities by hive_id, the leading
--   column of the unique (hive_id, type, canonical_name).

alter type public.entity_type add value if not exists 'vendor';
alter type public.entity_type add value if not exists 'subject';

create function public.topic_rules() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_space constant text := E' \t\n\r\f\x0B';
  v_name text := btrim(coalesce(new.canonical_name, ''), v_space);
  v_aliases text[] := '{}';
  v_alias text;
begin
  if v_name = '' then
    raise exception 'a topic needs a name';
  end if;
  if char_length(v_name) > 80 then
    raise exception 'that topic name is too long';
  end if;
  new.canonical_name := v_name;

  foreach v_alias in array coalesce(new.aliases, '{}'::text[]) loop
    v_alias := btrim(coalesce(v_alias, ''), v_space);
    if v_alias = '' or v_alias = any (v_aliases) then
      continue;
    end if;
    if char_length(v_alias) > 80 then
      raise exception 'that topic alias is too long';
    end if;
    v_aliases := v_aliases || v_alias;
  end loop;
  if cardinality(v_aliases) > 20 then
    raise exception 'a topic has at most 20 aliases';
  end if;
  new.aliases := v_aliases;

  if tg_op = 'INSERT' then
    if coalesce(pg_catalog.current_setting('role', true), '') in ('anon', 'authenticated')
       and not public.is_hive_owner(new.hive_id) then
      return new;
    end if;
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('topic_cap:' || new.hive_id::text, 0));
    if (select count(*) from public.entities e where e.hive_id = new.hive_id) >= 2000 then
      raise exception 'this hive already has 2000 topics';
    end if;
  end if;
  return new;
end
$$;

create trigger zzzz_topic_rules before insert or update of canonical_name, aliases
  on public.entities for each row execute function public.topic_rules();

-- The database's own: a trigger function is never called by hand.
revoke all on function public.topic_rules() from public, anon, authenticated;

alter table public.note_entities add column detached_at timestamptz;

create policy note_entities_update on public.note_entities for update to authenticated
  using (public.jwt_agent_id() is null
         and exists (select 1 from public.notes n
                      where n.id = note_id
                        and n.member_id in (select public.my_member_ids())))
  with check (public.jwt_agent_id() is null
              and exists (select 1 from public.notes n
                           where n.id = note_id
                             and n.member_id in (select public.my_member_ids())));

revoke update on public.note_entities from authenticated;
grant update (detached_at) on public.note_entities to authenticated;

alter policy note_entities_delete on public.note_entities
  using (public.jwt_agent_id() is null
         and exists (select 1 from public.notes n
                      where n.id = note_id and n.member_id in (select public.my_member_ids())));
