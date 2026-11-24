# Create a hive and switch between hives

Date: 2026-11-24. Status: approved by Danijel in the session.

## Problem

The database is multi-hive and has `create_hive`, but the app has no way to start a hive and
always shows the hive of the person's oldest membership. A person in two hives cannot reach the
second one.

## Decisions (Danijel, 2026-11-24)

- Any signed-in person may start a hive, up to 5 hives they own.
- The hive's name at the top of the rail is the switcher; it also holds "New hive".

## Design

### Which hive a screen shows

- The chosen hive's id is kept in a cookie, `hm_hive`: httpOnly, `SameSite=Lax`, `Secure` in
  production, path `/`, one year.
- `ownHive` (`web/src/app/own-hive.ts`) stays the one place that answers "which hive". It reads
  the person's memberships (`members` by `user_id`, oldest first, at most 50, the same indexed
  read as today with a larger limit) and answers the one whose `hive_id` is the cookie's value,
  else the oldest. The cookie only picks among rows the database returned for this person, so a
  forged or stale value picks nothing and reveals nothing.
- The cookie is read through one helper, `chosenHiveId()`, which answers null outside a request
  (tests, build). The twelve callers of `ownHive` do not change.
- Server actions that write (vault, gallery, settings) already name the row they change by id
  and let row-level security decide; where they look up "my member in my hive" they follow the
  same cookie. A tab left open on the old hive after a switch elsewhere therefore acts on the
  new hive's member for hive-level actions, and on the named row for row-level ones. Each such
  action refreshes the page afterwards, so the tab shows the new hive from then on.

### Switch

- Server action `switchHive(hiveId)`: validates the uuid, reads the person's membership in that
  hive (row-level security answers), sets the cookie only when it exists, returns `{ ok }`.
  The client then reloads the current path.
- Joining a hive (`/join`) and creating one set the cookie to that hive.
- Signing out clears the cookie.

### Create

- Server action `createHive(name, displayName)` answers `{ ok: true }` or
  `{ ok: false, reason }` with reasons `name`, `display-name`, `limit`, `failed`. It trims and
  checks both texts, calls `create_hive`, sets the cookie, and the client goes to `/`.
- Migration `20261124082437_hive_cap` replaces `create_hive` (same signature and guards):
  - both texts are trimmed (space, tab, newline, return, form feed, `\x0B`); the hive name must
    be 1 to 60 characters and the display name 1 to 60, else `a hive needs a name`,
    `that hive name is too long`, `you need a name in the hive` or `that name is too long`;
  - at most 5 hives owned by the caller (memberships with role `owner`), counted under an
    advisory lock per user, else `you already own 5 hives`;
  - writes audit `hive.created` (hive, the new member, `detail = {"name": ...}`).
- No change to any policy or to who can read what.

### Rail

- The top of the rail shows the mark and the current hive's name as a button (a disclosure,
  following the account menu's pattern). It opens a list of the person's hives, each with the
  person's role there and a tick on the current one, then **New hive**.
- New hive opens a small form in the same popover: "Hive name" and "Your name in this hive"
  (prefilled with the current display name), **Create** and **Cancel**. Refusals show one line
  under the form: the name rules, "You already own 5 hives.", or the usual failure line.
- A person in no hive (the home page's existing empty state) gets the same **New hive** form
  there, so a first hive can be started without an invitation.
- `Account` gains `hiveId` and `hives: { id; name; role; current }[]`; the account menu keeps
  showing the current hive and role.
- Look: existing rail tokens and the account popover's classes; another session reworks the look.

### Connecting an app

Agents belong to a member, and a member belongs to one hive, so agents and app connections are
per hive. The consent screen (`/oauth/consent`) already lists the workspaces of the hive
`ownHive` answers; it now names that hive, so the person sees which hive an app is being
connected to.

## Performance and data budget

- First paint of every screen: the rail's membership read returns up to 50 rows instead of 1.
  No new round trip.
- Switch: one action (one indexed read, one cookie), then a reload of the current page.
- Create: one rpc, then a navigation to `/`.
- The switcher's list is client state from the data already loaded; opening it costs nothing.

## Independent units

1. Migration and database tests.
2. Hive selection and actions (`own-hive`, `chosen-hive`, `account`, `switchHive`,
   `createHive`, join and sign-out cookie handling, consent heading).
3. Rail switcher, New hive form, the no-hive page, dev page and browser tests.
4. Docs.

Units 2 and 3 meet at the `Account` type and the two action signatures, fixed in the plan.

## Not in this slice

- Renaming, deleting or leaving a hive.
- An agent that works across hives.
- More than 50 memberships per person.
