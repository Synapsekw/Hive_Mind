---
type: session
date: 2026-11-23-1330
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[2026-11-23-1139-file-gallery-and-inbox-merged]]"
---

# Phase 2 promoted to main; settings for agents and members merged

## What changed

- **Inbox on the hosted project.** The history row of `20261123071625_inbox` had been inserted
  without the migration's SQL; the SQL was run unchanged through the Supabase MCP. Tried by hand
  with a real link: the Mac agent proposed one from `clients/acme/proposal.md` to a test note of
  `Test Colleague`, Danijel accepted in the app, the other side was accepted through SQL, and
  the two notes opened to each other.
- **Phase 2 promoted:** PR #2 (`develop` to `main`) merged after CI passed (`693f590`).
- **Settings merged** into `develop` (`0b68052`), first slice of Phase 3: `/settings` lists the
  member's agents (connect, token shown once in a dialog, revoke) and the hive's members (the
  owner adds a person who already has an account). No migration; it wraps `create_agent`,
  `revoke_agent` and `add_member`. Spec and plan: `2026-11-23-settings-*`.
- **Review of the settings branch** found no blocking defect. Fixed from it: the token dialog now
  survives browser Back and asks before reload, a held Enter no longer copies the token, the page
  is locked while an agent is being created, and the 200-agent cap takes agents in use first.

## Why

Creating an agent by SQL put a token into a query result, from where it was pasted into a chat
the same morning. Settings removes the SQL from the everyday path and is the base for
invitations and the remote connector.

## How to test (for the user)

On `develop`, hosted project, `pnpm dev:web`:

1. Open **Settings** in the rail. Your agents and the three members are listed.
2. **Connect an agent**: give a name, choose workspace `Main`, provider, trust tier, **Create**.
   A dialog shows the token once. Escape and a click outside do nothing; browser Back keeps the
   dialog. **Copy**, then **Done**: the dialog closes and the new agent is in the list.
3. **Revoke** that agent: it asks "Revoke {name}?"; **Revoke** again after half a second. The row
   turns to "Revoked".
4. **Add a member** with an email nobody has: "Nobody with that email has an account yet." With
   the test colleague's email: "That person is already a member."
5. `/dev/settings` shows the same screen on sample data; `?member=1` shows it as a non-owner.

Step 2's last part (the list re-read after Done on the real page) is the one thing not covered
by an automated test.

## Open threads

- No test proves the list is re-read from the server after an action; the sample page updates
  its own data.
- Settings non-goals still open: invitations and sign-up, token expiry, removing a member, role
  changes, renaming an agent.
- The two link behaviours from the inbox review still await a decision (reverse re-proposal
  after a decline; decline undoing an accepted link).
- The hive holds test data: `Test Colleague`'s note `clients/acme/pricing-notes.md` and an
  accepted link to `clients/acme/proposal.md`.
- The merged branch `task/keystone-glass` still exists locally and on GitHub.

## Next session entry point

Next slice of Phase 3: invitations for people without an account, designed together with how a
new colleague signs up; then the agent sign-in rework (legacy JWT secret), the remote MCP
connector and hosting.
