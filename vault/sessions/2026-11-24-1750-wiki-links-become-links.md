---
type: session
date: 2026-11-24-1750
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[2026-11-24-decision-15-the-hive-owner-pays-for-hive-maintenance]]"
  - "[[2026-11-24-1459-delete-a-hive-merged]]"
---

# Wiki links become links

## What changed

- Folder import shipped earlier today (`d473db5`) and Danijel imported the DRA vault through it:
  1,643 notes in workspace "DRA Vault" of hive "Autonomous Mobility Etisalat", no links, as
  designed ("import only").
- New slice, merged as `841754a` and deployed: the `[[wiki links]]` between a person's own notes
  in one workspace become accepted links (tier 2). It runs at the end of every folder import and
  from "Connect wiki links" in the vault. No migration: the existing link rules decide.
- Code: `web/src/import/wikilinks.ts` (find and resolve), `web/src/app/vault/connect.ts` (one
  server step of 40 notes), `web/src/vault/connectRun.ts`, `Connect.tsx`, changes to
  `Import.tsx` and `Vault.tsx`. Spec and plan dated 2026-11-24 under `docs/superpowers/`;
  `docs/security.md` section 14.
- Decision recorded: the hive owner pays for hive maintenance
  ([[2026-11-24-decision-15-the-hive-owner-pays-for-hive-maintenance]]).
- The deploy also put the Rings map, the darker Hive theme, the filter bar and the folding rails
  on the live site; they were on `develop` (`0833845`) and had not been deployed.
- Gates at merge: 288 database and tooling tests, 1,897 web unit tests, typecheck, lint, build.
  The vault's browser tests (102) passed on the branch.

## Why

Danijel asked why the imported vault looked unconnected. The references were in the text and
nothing read them. Matching them needs no model, so it was pulled forward from Phase 4.

## How to test (for the user)

1. Open `https://hive-mind-synapse.netlify.app/vault` and reload. Switch to the hive
   "Autonomous Mobility Etisalat" and open the workspace "DRA Vault".
2. Next to "Import a folder" there is a button "Connect wiki links". Press it, then "Connect".
   Expect a progress line counting up to 1,643 notes read, about half a minute.
3. Expect three counts at the end: "Links made" (a few thousand), "Already linked" (0), "Pointing
   at no note".
4. Open a note that has wiki links in its text. Expect "Linked with" to list the notes it names.
5. Open the map. Expect the DRA notes joined by lines.
6. Press "Connect wiki links" again. Expect "Links made 0" and the earlier number under "Already
   linked".
7. Optional: import a small folder with two notes that link to each other into a new workspace.
   Expect "Connecting wiki links" after the notes are sent and "Links made 1".

## Open threads

- Not run on the real project yet: the first real run is Danijel's test. Then time `map_graph`
  with the new links, before promotion.
- Delete a hive and folder import still wait for Danijel's test result; nothing after the hive
  switcher is on `main`.
- Accepted limits: an unlink between own notes comes back on the next run; a removed reference
  keeps its link; agents' later notes are not scanned by themselves; a path over 4,000
  characters stops a run; the browser tests have no axe check (hand-written name checks only).
- Phase 4 must run paid maintenance on the server with a key per hive, with spending the owner
  can see and cap.

## Next session entry point

Ask for the result of the "Connect wiki links" run on the DRA vault, time `map_graph`, then
promote `develop` to `main` once delete-a-hive and the import are confirmed.
