---
type: session
date: 2026-11-24-1459
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[2026-11-24-1307-hive-switcher-merged]]"
  - "[[2026-11-24-gotcha-09-the-api-role-can-become-the-service-role-in-sql]]"
---

# Delete a hive: seven days to cancel, then erased by a scheduled job

## What changed

- **Decided (Danijel):** delete marks a hive for deletion; 7 days read-only with a banner; the
  owner can cancel; then it is erased.
- **Merged to `develop`** (`a840874`, `task/delete-hive`). Spec and plan under
  `docs/superpowers/`, dated 2026-11-24; the spec lists what two security reviews changed.
- **Database** (`20261124091833_hive_deletion`, applied): the closing state; one freeze trigger
  on all 12 hive tables (revoking an agent and sign-in stamps stay open); request, cancel and
  preview for owners; a point of no return (`begin_hive_purge`) after which cancel is refused;
  `purge_hive` erasing about 2,000 rows a call and refusing while stored objects remain;
  `deleted_hives` as the permanent record; rows can no longer be tied to two hives; a person
  cannot change which agent a note says wrote it.
- **Edge Function `purge-hives`** (deployed) and `scripts/setup-hive-purge.sh` (run): the
  database's scheduler calls it daily at 03:17 UTC with a secret the database generated.
- **Web:** "Delete this hive" in Settings, the banner with Cancel deletion, "being deleted" in
  the switcher.
- **Two security reviews** found and closed: a member blocking an erase with a row tied to two
  hives; a late cancel keeping a hive without its files; objects left behind; a hive padded
  until its erase timed out. Trap recorded:
  [[2026-11-24-gotcha-09-the-api-role-can-become-the-service-role-in-sql]].
- Gates: 283 database and tooling tests, 1,599 web unit tests, 277 browser tests.

## Why

Second of the three slices asked for before Phase 4. Deleting a hive destroys every member's
notes, so it could not be one irreversible press.

## How to test (for the user)

On the live site, with a test hive. Not yet confirmed by Danijel when this note was written.

1. Settings, "Delete this hive": counts, a name field, the button disabled.
2. A wrong name keeps it disabled; the exact name enables it. Press it. Expect a banner with a
   date 7 days ahead on every screen, and "being deleted" in the hive switcher.
3. Try to invite a member. Expect the failure line.
4. Switch to another hive. Expect no banner and normal behaviour.
5. Switch back, press "Cancel deletion" and confirm. Expect the banner gone and invites working.

## Open threads

- **No real erase has run.** Unproven on the hosted project: the role check inside
  `purge_hive`, listing stored objects, and step time against the 8 second limit. To prove it,
  mark a test hive, set its date to the past by hand (with Danijel's go-ahead) and trigger a run.
- Not promoted to `main` yet; waits for Danijel's test.
- Members are told by the banner only. No export, no removing one member, no leaving.
- An account in a closing hive cannot be deleted until the hive is erased or kept.
- Anyone signed in who knows a hive's id can learn that it is closing.
- Deleting agents, workspaces and members during an erase reads tables without an index on the
  referencing column; capped at 100 a call, not measured at size.
- The shared browser-test port and two load-sensitive map tests, as noted before.

## Next session entry point

After Danijel's test: promote `develop` to `main`. Then the last slice, importing a folder of
notes from the app, then Phase 4.
