---
type: session
date: 2026-11-24-1210
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[2026-11-24-0946-emailed-invitations-live]]"
  - "[[2026-11-23-1139-file-gallery-and-inbox-merged]]"
---

# Sign-ups closed; a declined link is final and Unlink is its own action

## What changed

- **Sign-ups are closed** on the dev project (Danijel, in the dashboard; read back through the
  management API): mail through Resend, "Confirm email" on, email code 10 digits living 86400
  seconds, minimum password length 10, "Allow new users to sign up" off. An uninvited address is
  refused with `signup_disabled`; an invitation was sent and joined afterwards.
- **Decided (Danijel):** a declined pair of notes cannot be proposed again, with no undo;
  ending an accepted link is a separate Unlink action, in the vault.
- **Merged to `develop`** (`99943e4`, `task/link-behaviours`): migration
  `20261124074246_link_behaviours` (one link per pair in either direction, `respond_to_link`
  refuses to decline an accepted link, new `unlink` and `note_links`, audit entries
  `link.accepted`, `link.declined`, `link.unlinked`); the vault's "Linked with" list with
  Unlink; the inbox Decline sentence; the MCP tool description. Spec and plan under
  `docs/superpowers/`, dated 2026-11-24.
- **Live:** migration applied and recorded, the `mcp` function redeployed, the site redeployed.
  Danijel unlinked the one test link by hand and the proposal was refused afterwards.
- Gates: 234 database and tooling tests, 1,362 web unit tests, 223 browser tests.

## Why

Both link behaviours had shipped undecided and had to be settled before a colleague joins: a
person who said no was asked again from the other side, and "decline" silently ended a link
both people had agreed to.

## How to test (for the user)

On the live site. Danijel ran these on 2026-11-24 and all passed.

1. Open a note that has an accepted link in the vault. Expect a "Linked with" list with the
   other note, its owner and Unlink.
2. Press Unlink, then Keep. Expect the list unchanged.
3. Press Unlink and confirm. Expect the row gone and the line gone from the map.
4. Ask an agent to propose the same link again. Expect "this link was declined".
5. Open a note without links. Expect no "Linked with" heading.

## Open threads

- Withdrawing a proposal counts as a decline, so it closes the pair for good as well.
- No notice to the colleague when a link is declined or unlinked, and no undo.
- The "Linked with" block reuses vault styles and sits tight under the sharing control; left
  for the look rework.
- The dev hive now has no accepted link; the Acme test notes are still there.
- A test in the invitations suite depended on row order within one millisecond; made
  order-independent.
- "Secure password change" reads as off in the project's settings, while gotcha 07 recorded it
  as on. Not looked into.

## Next session entry point

Invite the first real colleague. Then Phase 4 (linking): start with `/whats-next` or a
brainstorm on the entity registry and link discovery.
