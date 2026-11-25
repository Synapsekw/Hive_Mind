-- 20261125063103_vault_index.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp). Do not hand-edit
-- the version, and never edit a migration that has shipped.
--
-- What this migration does:
--   public.vault_index(p_workspace): the vault's note index for one of the
--   caller's own workspaces, in one pass. The vault used to select notes with
--   four computed columns (note_visibility, note_shared_with, note_rule_folder,
--   note_access) and an embed of note_entities; under row-level security each
--   of those re-ran _can_read_note and the folder rule lookup per row, and the
--   embed re-checked the note's policy per topic: about 3.7 s for 1,641 notes.
--
--   Same answers as those columns (tests/sharing-rules.test.mjs compares them
--   row for row), as their latest definitions give them for the caller's own
--   notes (20261123150712_connected_apps.sql over
--   20261122115431_folder_rules_by_path.sql):
--     effective      = _note_visibility: the note's setting, else the nearest
--                      rule folder's (note_folder_rule), else the member's
--                      default.
--     effective_with = _note_shared_with: the note's list when it has a
--                      setting, else the rule folder's, else '{}'.
--     rule_folder    = the path of note_folder_rule.
--     access         = 'own': every row here is the caller's own note.
--     topics         = [{entity_id, confidence}] of the note's attached
--                      topics (detached_at is null), strongest first; [] when
--                      none.
--   The rule folder is found by one lateral join with exactly the conditions
--   of note_folder_rule (same workspace and member, a rule set, a proper
--   ancestor by path compared without `like`, nearest first).
--
--   Who gets rows: only the workspace's owner, signed in as a person. The
--   caller's membership is checked once, by joining the workspace's member to
--   auth.uid(). An agent token, a self-hosted claim and a connected app's pass
--   (or a token for another audience) get no rows; none of them opens the
--   vault. Another member, an outsider or an id nobody has gets no rows. The
--   public cannot execute it. At most 2001 rows (the vault shows 2000 and
--   needs one more to know it was cut), ordered by path.
--
--   Nothing changes in who can see what: this answers a subset of what the
--   notes_select policy already lets the owner read.

create function public.vault_index(p_workspace uuid)
returns table (
  id uuid, workspace_id uuid, member_id uuid, path text, title text,
  updated_at timestamptz, written_by_agent uuid, visibility public.visibility,
  shared_with uuid[], quarantined boolean, effective public.visibility,
  effective_with uuid[], rule_folder text, access text, topics jsonb)
language sql stable security definer set search_path = '' as $$
  select n.id, n.workspace_id, n.member_id, n.path, n.title, n.updated_at,
         n.written_by_agent, n.visibility, n.shared_with, n.quarantined,
         coalesce(n.visibility, r.visibility, m.default_visibility),
         case when n.visibility is not null then n.shared_with
              else coalesce(r.shared_with, '{}') end,
         r.path,
         'own'::text,
         coalesce((select jsonb_agg(jsonb_build_object(
                             'entity_id', e.entity_id,
                             'confidence', e.confidence)
                           order by e.confidence desc, e.entity_id)
                     from public.note_entities e
                    where e.note_id = n.id and e.detached_at is null),
                  '[]'::jsonb)
    from public.workspaces w
    join public.members m
      on m.id = w.member_id and m.user_id = (select auth.uid())
    join public.notes n
      on n.workspace_id = w.id and n.member_id = m.id
    left join lateral (
      select x.path, x.visibility, x.shared_with
        from public.folders x
       where x.workspace_id = n.workspace_id
         and x.member_id = n.member_id
         and x.visibility is not null
         and left(n.path, length(x.path) + 1) = x.path || '/'
       order by length(x.path) desc
       limit 1) r on true
   where w.id = p_workspace
     and public.jwt_oauth_client() is null
     and public.jwt_agent_id() is null
     and not public.jwt_is_self_hosted()
   order by n.path
   limit 2001
$$;

revoke all on function public.vault_index(uuid) from public, anon;
grant execute on function public.vault_index(uuid) to authenticated;
