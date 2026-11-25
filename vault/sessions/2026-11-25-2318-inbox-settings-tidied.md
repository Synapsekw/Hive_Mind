---
type: session
date: 2026-11-25-2318
branch: develop
trigger: wrapup
status: complete
tags: [session]
related: [[2026-11-25-1110-vault-tidied]]
---

# Inbox and Settings tidied (interface rework, round 3)

## What changed

- **Inbox (layout B):** a list on the left and one decision at a time on the right. The list groups links to decide and held notes, and you move through it with ↑/↓, Home, End and Enter.
  - **Detail pane:** shows the opening lines of your own note or a held note. These come from one new server action, `noteOpening`/`openingIn`, which does one read by note id, cuts the text to 280 characters on the server, and caches it per id.
  - **After an answer:** the next item is selected for you.
  - **Narrow window (under 1,000 px):** the card folds to the list or the detail, with "← Inbox" and Escape to go back. Merge `aa5b2ed`.
  - **Colleague's note:** still shows only the name, topic and title.
- **Settings (layout B):** tabs in the top bar (Agents, Workspaces, Topics, People, Hive), kept in the address with `?tab=` and switched with no server call.
  - **Row menus:** one shared ⋯ menu for revoke, delete workspace, delete topic, send again and revoke invitation.
  - **Dialogs:** connect an agent, Find topics, invite and delete hive each open in a dialog, and nothing behind an open dialog (the tabs included) can be reached.
  - **Topics:** search, filters by kind and a grid.
  - **People:** members and invitations in one list.
  - **Members:** still have no Topics or Hive tab.
- **Docs:** `docs/ui-concept.md` updated. Spec and plan are `docs/superpowers/specs|plans/2026-11-25-inbox-settings-tidy*`.
- **Build:** subagent-driven, 9 tasks, each reviewed. A final review found that a test had been deleted and that the connect dialog did not block what is behind it; both were fixed. A second fix stopped a Find topics that finishes on another tab from locking the tabs.
- **Checks:** typecheck, lint, 323 node and 2,280 web unit tests, the build, and 442 Chromium browser tests all pass.

## Why

This is round 3 of the interface rework, after the map controls and the Vault. The Inbox and Settings had become long pages of stacked sections; now they show one thing at a time while keeping today's rules, words and token safety.

## How to test (for the user)

Pull `develop`, run `pnpm dev:web`, sign in as the owner. It is not deployed to the Netlify site yet. With no data, use the sample pages `/dev/inbox` and `/dev/settings` instead.

1. **Inbox list:** open `/inbox`. Links to decide and held notes are on the left, and the first is open on the right.
2. **Opening lines:** your note's first lines show; the colleague's side shows only "Not shared with you".
3. **Keyboard:** ↑/↓ move through the list, and Enter opens an item.
4. **Decline:** press Decline. The "are you sure" question appears in the pane. Keep closes it; Decline again declines, shows "Link declined." and opens the next item.
5. **Narrow window:** make the window narrower (under about 1,200 px). The card shows only the list. Open an item, then press "← Inbox" or Escape to go back.
6. **Tabs in the address:** open `/settings`. Tabs sit in the top bar. Switch tabs: the address changes (`?tab=people`) and reloading keeps the tab.
7. **Connect an agent:** in Agents, press Connect an agent. A dialog opens and the tabs behind it can't be used. Create one: the token dialog shows as before, and leaving asks first.
8. **Revoke an agent:** press ⋯ on an agent, then Revoke…, then Keep. Focus returns to ⋯.
9. **Topics filters:** in Topics, type in "Find a topic" and press a kind chip. The grid filters at once.
10. **Find topics:** press "Find topics in my notes", switch to People while it runs, then go back. The found topics wait in a dialog.
11. **People:** members and invited addresses are one list. Invite someone opens a dialog, and ⋯ on an invitation has Send again and Revoke invitation.
12. **Delete hive:** in Hive, Delete hive… opens a dialog that needs the hive's name typed exactly. Press Keep; don't delete.
13. **Member view:** as a member (or `/dev/settings?member=1`), there are no Topics or Hive tabs, and `?tab=hive` opens Agents.

## Open threads

- **Danger colour:** themes have no danger colour, so the Hive box and danger menu items use bold text colour, not red. The spec says red; adding it needs a token in every theme. Decision for Danijel.
- **Invite field order:** the invite form keeps today's order (Email, then Display name); the spec said Name, Email.
- **Minor findings left on purpose:**
  - A double-click on Decline at a very wide window lands on Keep. It fails safe.
  - A failed opening line is cached until reload.
  - A wrapped held-note line starts with a stray "·".
  - The list groups hold a heading inside the listbox (plan-mandated).
  - The Hive dialog gets no focus back after browser Back.
  - The Workspaces heading count lags for a moment after a delete.
- **Not deployed or promoted:** round 3 is on `develop` only, and Gallery round 3 was deferred. The shell is round 4.
- The other sessions' drafts `_draft-2026-11-25-1217.md` and `-1507.md` are left in place.

## Next session entry point

Have Danijel try the walkthrough above, then deploy `develop` to the Netlify site. Next comes the Gallery tidy (start with a visual walk-through, now that gallery v2 is merged), then round 4, the shell.
