-- 20261124074246_link_behaviours.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp). Do not hand-edit
-- the version, and never edit a migration that has shipped.
--
-- What this migration does:
--   Link behaviours. A decline is final, it answers a proposal only, and
--   ending a link both people accepted is its own action, Unlink.
--
--   - One link per pair of notes, whichever way it points. links_pair_idx is
--     unique on (least(from_note, to_note), greatest(from_note, to_note)).
--     Before, only the same direction was refused, so a declined link could
--     be proposed again from the other side.
--     This index cannot be built while a pair has a row in each direction:
--     look for such pairs before applying it to a database that has links.
--   - links_before_insert: replaced. It looks for a link between the two
--     notes first and tells an owner of either note 'this link was declined'
--     (declined or unlinked) or 'these notes already have a link' (proposed
--     or accepted). Only an owner is told: the trigger runs before row-level
--     security, and an owner may already read every link of their note
--     (links_select). Anyone else is refused by row-level security as before,
--     with the same answer whether the pair has a link or not. The index is
--     what holds for a caller with no person behind it and for two opposite
--     proposals made at the same moment. It also clears ended_at and
--     ended_by, so a proposer cannot set them. The rest is unchanged.
--   - links.ended_at, links.ended_by: when a link was declined or unlinked,
--     and by which member. Nobody writes them through the API.
--   - respond_to_link(link, accept): replaced, same signature and guards.
--     Declining an accepted link raises 'this link is accepted; unlink it
--     instead'. Declining a declined link answers 'declined' and changes
--     nothing. A decline stamps ended_at and ended_by and writes
--     'link.declined' to the audit log. The accept that completes a link
--     writes 'link.accepted'; accepting an accepted link again answers
--     'accepted' and writes nothing.
--   - unlink(link): new. A person who owns one of the two notes ends an
--     accepted link. Two owners: the link becomes declined, stamped, and the
--     pair can never be proposed again. One owner on both sides (accepted at
--     once, no handshake): the row is deleted, so the two notes can be linked
--     again. Either way 'link.unlinked' goes to the audit log. Refuses an
--     app pass, an agent and anything else that is not a person.
--   - note_links(note): new. The accepted links of one note where the caller
--     owns at least one side: the link, and the other note's id, title and
--     owner, newest first, at most 50. A person only; an agent, an app pass
--     or a visitor gets no rows. A link whose other note the caller cannot
--     read (held for review) is left out, as on the map.
--   - Audit rows: hive_id, the acting member, note_id = the caller's note in
--     the link (from_note when both are theirs), detail = {link, other_note}.
--
--   What it leaves alone: who can read a note. can_read_note already follows
--   accepted links only, so an unlinked note closes at once. The policies on
--   links are unchanged (no update or delete through the API). Agents still
--   cannot accept, decline or unlink.

-- ------------------------------------------------------------------- links

alter table public.links
  add column ended_at timestamptz,
  add column ended_by uuid references public.members on delete set null;

create unique index links_pair_idx on public.links
  (least(from_note, to_note), greatest(from_note, to_note));

create or replace function public.links_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  a public.notes;
  b public.notes;
  v_status public.link_status;
begin
  select * into a from public.notes where id = new.from_note;
  select * into b from public.notes where id = new.to_note;
  -- One link per pair, in either direction. The answer in plain words goes to
  -- an owner of one of the two notes only (an app pass owns nothing here).
  -- For everyone else nothing is said: row-level security refuses them next,
  -- and links_pair_idx refuses a caller that row-level security does not bind.
  select l.status into v_status
    from public.links l
   where least(l.from_note, l.to_note) = least(new.from_note, new.to_note)
     and greatest(l.from_note, l.to_note) = greatest(new.from_note, new.to_note);
  if found and exists (select 1 from public.my_member_ids() m
                        where m in (a.member_id, b.member_id)) then
    if v_status = 'declined' then
      raise exception 'this link was declined';
    end if;
    raise exception 'these notes already have a link';
  end if;
  if a.id is null or b.id is null or a.hive_id <> b.hive_id then
    raise exception 'both notes must exist in the same hive';
  end if;
  new.hive_id := a.hive_id;
  new.status := 'proposed';
  new.to_accepted_at := null;
  new.ended_at := null;
  new.ended_by := null;
  -- A person proposing a link has accepted their own side. An agent has not.
  new.from_accepted_at := case
    when public.jwt_agent_id() is null and (select auth.uid()) is not null then now()
  end;
  -- Two notes of the same owner need no handshake.
  if a.member_id = b.member_id then
    new.status := 'accepted';
    new.from_accepted_at := now();
    new.to_accepted_at := now();
  end if;
  return new;
end
$$;

-- ------------------------------------------------------- accept or decline

-- Accept or decline your side of a proposed link. People only.
create or replace function public.respond_to_link(p_link uuid, p_accept boolean) returns public.link_status
language plpgsql security definer set search_path = '' as $$
declare
  l public.links;
  v_from_owner uuid;
  v_to_owner uuid;
  mine_from boolean;
  mine_to boolean;
  v_me uuid;
  v_note uuid;
  v_other uuid;
begin
  if public.jwt_oauth_client() is not null then
    raise exception 'an app pass cannot do this';
  end if;
  if (select auth.uid()) is null or public.jwt_agent_id() is not null then
    raise exception 'only a person can accept or decline a link';
  end if;
  select * into l from public.links where id = p_link for update;
  if l.id is null then
    raise exception 'link not found';
  end if;
  select n.member_id into v_from_owner from public.notes n where n.id = l.from_note;
  select n.member_id into v_to_owner from public.notes n where n.id = l.to_note;
  mine_from := coalesce(v_from_owner in (select public.my_member_ids()), false);
  mine_to := coalesce(v_to_owner in (select public.my_member_ids()), false);
  if not (mine_from or mine_to) then
    raise exception 'link not found';
  end if;
  -- The acting member and their note, for the audit log.
  if mine_from then
    v_me := v_from_owner; v_note := l.from_note; v_other := l.to_note;
  else
    v_me := v_to_owner; v_note := l.to_note; v_other := l.from_note;
  end if;

  if not p_accept then
    if l.status = 'accepted' then
      raise exception 'this link is accepted; unlink it instead';
    end if;
    if l.status = 'declined' then
      return 'declined';
    end if;
    update public.links
       set status = 'declined', ended_at = now(), ended_by = v_me
     where id = p_link;
    insert into public.audit_log (hive_id, member_id, action, note_id, detail)
      values (l.hive_id, v_me, 'link.declined', v_note,
              jsonb_build_object('link', l.id, 'other_note', v_other));
    return 'declined';
  end if;

  if l.status = 'declined' then
    raise exception 'this link was declined';
  end if;
  if l.status = 'accepted' then
    return 'accepted';
  end if;
  update public.links set
      from_accepted_at = case when mine_from then coalesce(from_accepted_at, now()) else from_accepted_at end,
      to_accepted_at = case when mine_to then coalesce(to_accepted_at, now()) else to_accepted_at end
    where id = p_link
    returning * into l;
  if l.from_accepted_at is not null and l.to_accepted_at is not null then
    update public.links set status = 'accepted' where id = p_link;
    insert into public.audit_log (hive_id, member_id, action, note_id, detail)
      values (l.hive_id, v_me, 'link.accepted', v_note,
              jsonb_build_object('link', l.id, 'other_note', v_other));
    return 'accepted';
  end if;
  return 'proposed';
end
$$;

-- ------------------------------------------------------------------ unlink

-- End a link both sides accepted. People only, and only an owner of one of
-- the two notes; anyone else gets 'link not found', the same as for a link
-- that is not there.
create function public.unlink(p_link uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  l public.links;
  v_from_owner uuid;
  v_to_owner uuid;
  mine_from boolean;
  mine_to boolean;
  v_me uuid;
  v_note uuid;
  v_other uuid;
begin
  if public.jwt_oauth_client() is not null then
    raise exception 'an app pass cannot do this';
  end if;
  -- A self-hosted claim without an agent id is refused as well.
  if (select auth.uid()) is null or public.jwt_agent_id() is not null
     or public.jwt_is_self_hosted() then
    raise exception 'only a person can unlink notes';
  end if;
  select * into l from public.links where id = p_link for update;
  if l.id is null then
    raise exception 'link not found';
  end if;
  select n.member_id into v_from_owner from public.notes n where n.id = l.from_note;
  select n.member_id into v_to_owner from public.notes n where n.id = l.to_note;
  mine_from := coalesce(v_from_owner in (select public.my_member_ids()), false);
  mine_to := coalesce(v_to_owner in (select public.my_member_ids()), false);
  if not (mine_from or mine_to) then
    raise exception 'link not found';
  end if;
  if l.status <> 'accepted' then
    raise exception 'this link is not accepted';
  end if;
  if mine_from then
    v_me := v_from_owner; v_note := l.from_note; v_other := l.to_note;
  else
    v_me := v_to_owner; v_note := l.to_note; v_other := l.from_note;
  end if;

  if v_from_owner = v_to_owner then
    -- Two notes of one owner: nobody was asked, so nothing is final.
    delete from public.links where id = p_link;
  else
    update public.links
       set status = 'declined', ended_at = now(), ended_by = v_me
     where id = p_link;
  end if;
  insert into public.audit_log (hive_id, member_id, action, note_id, detail)
    values (l.hive_id, v_me, 'link.unlinked', v_note,
            jsonb_build_object('link', l.id, 'other_note', v_other));
end
$$;

-- -------------------------------------------------------------- note_links

-- The accepted links of one note, for the vault: the link's id, then the
-- note on the other side. Only where the caller owns p_note or that other
-- note, so the title of a note is never given to someone who owns neither
-- side, whatever else lets them read p_note. A person only: for an agent, an
-- app pass or no user it returns no rows (my_member_ids is empty for a pass).
-- Both notes must be readable by the caller, as for a link on the map: a note
-- held for review is not named.
-- Reads by unique (from_note, to_note) and links_to_idx.
create function public.note_links(p_note uuid)
returns table (id uuid, note_id uuid, title text, owner text, mine boolean)
language sql stable security definer set search_path = '' as $$
  select l.id, o.id, o.title, m.display_name,
         o.member_id in (select public.my_member_ids())
    from public.links l
    join public.notes n on n.id = p_note
    join public.notes o
      on o.id = case when l.from_note = p_note then l.to_note else l.from_note end
    join public.members m on m.id = o.member_id
   where (l.from_note = p_note or l.to_note = p_note)
     and l.status = 'accepted'
     and (select auth.uid()) is not null
     and public.jwt_oauth_client() is null
     and public.jwt_agent_id() is null
     and not public.jwt_is_self_hosted()
     and (n.member_id in (select public.my_member_ids())
          or o.member_id in (select public.my_member_ids()))
     and public._can_read_note(n)
     and public._can_read_note(o)
   order by l.created_at desc, l.id
   limit 50
$$;

-- ------------------------------------------------------------------ grants

-- create or replace keeps the grants of links_before_insert and
-- respond_to_link.
revoke all on function
  public.unlink(uuid),
  public.note_links(uuid)
from public, anon;
grant execute on function
  public.unlink(uuid),
  public.note_links(uuid)
to authenticated;
