# Delete a hive, with seven days to cancel

Date: 2026-11-24. Status: approved by Danijel in the session.

## Problem

A hive cannot be deleted. Deleting one destroys every member's notes and files in it, so it
must not be a single irreversible press.

## Decision (Danijel, 2026-11-24)

Delete marks the hive for deletion. For 7 days everyone in it sees a banner and can still read;
nothing can be written; the owner can cancel. After 7 days a scheduled job erases it for good.

## Design

### State

`hives` gains `closing_at`, `delete_after` (= `closing_at` + 7 days) and `closing_by` (the auth
user who asked). A hive with `delete_after` set is **closing**.

### Asking and cancelling (people who own the hive only)

- `hive_deletion_preview(hive)` answers how many members, notes and files the hive holds.
- `request_hive_deletion(hive, name)`: the caller types the hive's name; it must equal the
  stored name. Sets the three columns and writes audit `hive.deletion_requested`. Asking again
  for a closing hive answers the same date and changes nothing.
- `cancel_hive_deletion(hive)`: clears the three columns and writes audit
  `hive.deletion_cancelled`.
- All three refuse an agent, an app pass and anyone who is not an owner of that hive. A person
  who is not a member gets `hive not found`, the same as for a hive that does not exist.

### The freeze

While a hive is closing, every write to its data is refused with `this hive is being deleted`:
inserts, updates and deletes on every table that holds hive data (notes and their versions,
folders, files, links, workspaces, agents, invitations, entities, note entities, synthesis
pages, members), and new stored objects under the hive's members. It is one trigger function
attached to each table, so it also binds the security-definer functions, agents and the
connector, with no per-function guard to forget.

Not frozen:

- reading, for everyone who could read before;
- the hive row itself (so cancelling works) and the audit log (so the request is recorded);
- agent sign-in and the connector's sign-in, which must keep working so agents can still read.
  If signing in stamps a "last used" time on a frozen row, that one column stays writable;
- marking a notification as read;
- the cascade when the hive itself is erased.

Cancelling lifts the freeze at once. Nothing was changed meanwhile, so the hive is as it was.

### The erase

- `deleted_hives` keeps a permanent record outside the hive: its id and name, who asked and
  when, when it was erased, and the counts of members, notes and files. Row-level security is
  on with no policy: only the server reads it.
- `hives_due_for_purge()` and `purge_hive(hive)` are for the service role only. `purge_hive`
  refuses a hive that is not closing or whose date has not come, writes the record and deletes
  the hive row; everything else goes by cascade.
- The Edge Function `purge-hives` does the work once a day. It is called by the database's
  scheduler (`pg_cron` with `pg_net`) with a shared secret in a header; anything without the
  right secret gets 401. With the service key it asks for the due hives (at most 20 a run),
  and for each: removes the hive's stored objects in batches, then calls `purge_hive`. If
  removing stored objects fails, that hive is left for the next run. The answer carries counts
  only, no names.
- `scripts/setup-hive-purge.sh` sets this up once per project: it makes the secret, stores it
  as the function secret `HIVE_PURGE_SECRET` and in the database's secret store, and schedules
  the daily call. It prints no secret.

### Web

- **Settings**, owners only: a "Delete this hive" section with the three counts and a field for
  the hive's name; **Delete hive** is enabled when the typed name matches. While closing, the
  section says when the hive will be erased and offers **Cancel deletion**.
- **Banner** on every screen of a closing hive, placed once in the root layout: "This hive will
  be deleted on (date). Nothing new can be saved." For an owner it has **Cancel deletion**.
- **Switcher**: a closing hive is marked "being deleted".
- Writes that are attempted anyway fail with the screens' existing failure lines; the banner
  says why.
- When a hive is erased, a person who had it chosen falls back to their oldest hive, or to the
  no-hive page; that already works through `ownHive`.

### MCP server

No change in code. A write to a closing hive comes back as the database's message.

## Performance and data budget

- First paint of every screen: `delete_after` rides on the membership read `ownHive` already
  makes. No new round trip.
- Settings: the preview (three counts over indexed columns) joins the page's existing parallel
  batch, for owners only.
- Request, cancel: one rpc each, then a page reload.
- Every write in any hive pays one lookup of the hive row by primary key.
- The erase runs outside any request, at most 20 hives a run.

## Independent units

1. Database: columns, freeze, the five functions, the record, tests.
2. Edge Function `purge-hives`, its tests and the setup script.
3. Web: account fields, actions, Settings section, banner, switcher mark, tests.
4. Docs.

Units meet at the contracts in the plan.

## Not in this slice

- Email to members when a hive is marked for deletion.
- Export of a hive as a download.
- Removing one member, or leaving a hive.
- Changing the 7 days.

## Rollout

Apply the migration with `supabase db query --linked -f`, record the version, deploy
`purge-hives`, run `scripts/setup-hive-purge.sh`, check the scheduled job exists and that a
call without the secret gets 401, redeploy the site. Have the migration's security reviewed
before applying.
