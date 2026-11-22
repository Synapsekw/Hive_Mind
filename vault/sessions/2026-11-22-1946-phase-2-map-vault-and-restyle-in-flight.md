---
type: session
date: 2026-11-22-1946
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[2026-11-22-decision-13-keystone-glass-look-with-themes]]"
  - "[[2026-11-20-decision-07-brain-dashboard-is-the-map]]"
---

# Phase 2: map and vault shipped, Keystone glass restyle in flight

## What changed

- **Web app, sign-in and the map** merged to `develop` (`986b21d`, fit-to-window fix `38b8bce`): new `web/` package, magic-link sign-in, `map_graph` (migration `20261122083415`) with hollow stubs for colleagues' unshared items. Spec and plan: `docs/superpowers/specs|plans/2026-11-22-web-map*`.
- **Vault and sharing controls** merged (`193c31f`): `/vault` with workspaces, folder tree, note list, markdown preview, per-note and per-folder sharing with a sentence before Save, held notes with Release, "Open in vault" from the map. Migration `20261122115431_folder_rules_by_path` applied to the hosted project and re-stamped: folder rules follow the path, agents cannot move notes, sharing changes are audited. Spec and plan: `2026-11-22-vault*`.
- Reviews before the vault merge caught and closed two real holes: a person could plant a sharing rule in someone else's workspace by re-pointing a folder row, and a colleague could confirm a locked note's exact path by guessing.
- **Keystone glass restyle** is built but not merged: branch `task/keystone-glass` (pushed, head `c56beea`), worktree `.claude/worktrees/keystone-glass`. Done there: theme engine with a contrast test over 102 combinations, look cookie, self-hosted fonts, shared rail with an Appearance panel, map, vault, sign-in and notices in the new look. Spec and plan: `2026-11-22-keystone-glass*`.
- Danijel tested the map, the fit fix and the vault by hand on the hosted project; all confirmed working.

## Why

Phase 2 gives people the place to see the hive and to decide what is shared; until the vault existed the only way to share a note was SQL. The restyle follows decision 13 so Hive shares one design language with Monolith.

## How to test (for the user)

The map and the vault were tested and confirmed on 2026-11-22. For the record, on `develop`:

1. In `E:\Dev\Hive_Mind` run `pnpm install`, then `pnpm dev:web`, and sign in.
2. The map shows your notes as dots, colleagues' unshared items as hollow dots, and fits one window.
3. **Vault** in the left rail: open a note, change its sharing through the pill, read the sentence, Save; set it back.
4. Select a folder, set a rule, check the counts in the sentence; set it to "No rule" afterwards.
5. On the map, select one of your notes and use "Open in vault".

The restyle is not on `develop` yet; nothing to test there until it merges.

## Open threads

- **Restyle, remaining on `task/keystone-glass`:** tasks 1 to 4 are reviewed clean; task 5 (sign-in and notices, `c56beea`) is built but not reviewed; task 6 (delete the temporary colour aliases in `globals.css`, check the no-blur fallback, look at all 17 themes in both modes, correct `docs/ui-concept.md` §2 and §6, add the 3.1 / 4.6 adjustment margin to the spec); whole-branch review; one fix wave; `scripts/finish-task.sh`. The build ledger and per-task reviews are in the worktree's git-ignored `.superpowers/sdd/2026-11-22-keystone-glass/` (`progress.md` first).
- Known, accepted in the restyle: light-mode Classic dot colours are darker than the concept doc's list (contrast rule); in the Rings view some dots sit under a neighbour's click area (older layout issue, keyboard still selects them).
- Not in the audit log yet: a change to a member's default visibility, and accepting a link.
- Browser tests (`web/e2e`) and `pnpm test:live` (19 checks) do not run in CI.
- Load time of the vault for a 2,000-note workspace is unmeasured; measure before importing the rest of the DRA vault.
- Phase 2 still owes the file gallery and the inbox.
- An empty folder `.claude/worktrees/vault` was held open by a process and could not be deleted; it is unregistered from git.

## Next session entry point

Enter `.claude/worktrees/keystone-glass`, read `.superpowers/sdd/2026-11-22-keystone-glass/progress.md`, finish the reviews and task 6, then merge. After that: the file gallery, then the inbox.
