---
type: session
date: 2026-11-24-1307
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[2026-11-24-1210-link-behaviours-merged]]"
---

# Start a hive and switch between hives from the rail

## What changed

- **Asked for (Danijel, 2026-11-24):** three slices before Phase 4: create and switch hives,
  delete a hive, import a folder of notes from the app (import only).
- **Merged to `develop`** (`c18659d`, `task/hive-switcher`): the hive's name at the top of the
  rail lists the person's hives and holds "New hive"; the chosen hive is the cookie `hm_hive`,
  read inside `ownHive`, which only picks among the person's own memberships; server actions
  `switchHive` and `createHive`; joining switches to the joined hive, signing out forgets the
  choice; the app-approval screen names the hive. Spec and plan under `docs/superpowers/`.
- **Database** (`20261124082437_hive_cap`, applied to the hosted project): `create_hive` allows
  at most 5 owned hives, checks both names (1 to 60 characters) and writes `hive.created`.
- **Added in review:** an invitation is bound on the server to the hive the settings page was
  showing, so a tab left on one hive cannot invite into another.
- Gates: 241 database and tooling tests, 1,486 web unit tests, 245 browser tests.
- Live and tested by Danijel: a second hive was created on the dev project.

## Why

The database was multi-hive from the start, but the app showed only the hive of the oldest
membership and had no way to start one. Deleting a hive and importing a folder both need the
app to know which hive is meant.

## How to test (for the user)

On the live site. Danijel ran these on 2026-11-24 and they passed.

1. Press the hive's name at the top of the rail. Expect the list of hives with a tick on the
   current one, and "New hive".
2. New hive with an empty name. Expect "A hive name is 1 to 60 characters."
3. New hive with a name. Expect an empty map and the new name at the top of the rail; Settings
   shows one workspace "Main", no agents, one member.
4. Choose the first hive in the list. Expect its map and notes back.
5. Close the tab and open the site again. Expect the hive chosen last.

## Open threads

- The browser tests share port 3100 with other sessions' dev servers. When another worktree's
  server holds it, Playwright reuses that server and tests the wrong code; run with a config on
  another port then. The map zoom-speed test fails under load and passes alone.
- No rename, delete or leave for a hive yet. The dev project now has a second, empty hive.
- Agents and app connections are per hive; a new hive starts with none.
- The switch and create buttons were exercised on sample data and by Danijel by hand, not by an
  automated test against a real session.
- `scripts/import-vault.mjs` imports into "the hive you belong to"; with several hives that
  needs a decision in the import slice.

## Next session entry point

`/develop` "delete a hive" (owner only). Decide first whether members get a warning or a grace
period. Then import a folder from the app.
