---
type: spec
status: active
last-updated: 2026-11-23
tags: [project/hive-mind, spec, ui]
---

# Settings: agents, tokens and members — design

First slice of Phase 3 (master spec §10). Phase 3's other parts (invitations for people without
an account, the agent sign-in rework, the remote MCP connector, hosting) are separate slices.

## Intent

Connecting an agent and adding a member are done today by running SQL in the Supabase dashboard.
That is slow, needs dashboard access, and puts the agent token in a query result, from where it
has already been pasted into a chat once. The database has had the functions since Phase 0
(`create_agent`, `revoke_agent`, `add_member`); this slice gives them a screen.

## Decisions taken with Danijel (2026-11-23)

- **Scope:** agents and tokens, plus members as they work today. No migration.
- **Members:** a list with roles; the owner can add a person **who already has an account**
  (`add_member`). Inviting someone without an account is the next slice, designed with sign-up.

Decided in the design (say so if any is wrong):

- **No token expiry yet.** `create_agent` takes none, so setting one would need a migration.
  Revoking is the control. Expiry arrives with the agent sign-in rework.
- **The token is shown once**, in a dialog, straight after creation, and is never stored, logged
  or shown again. A lost token means revoke and create a new one.
- **Setup instructions are for what works today:** Claude Code or a local MCP config. The
  connector route for the Claude and ChatGPT apps arrives with hosting.

## Goals, non-goals, anti-goals

- **Goals**
  - `/settings`, and "Settings" as the fifth entry in the left rail.
  - **Agents:** the person's own agents: name, provider, workspace, trust tier, created, last
    used, and whether it is active, revoked or expired. **Connect an agent** (name, workspace,
    provider, trust tier) and **Revoke**.
  - **The token dialog:** the token, a Copy button, what to do with it, and a plain warning that
    it will not be shown again.
  - **Members:** every member of the hive with their role. For the owner: **Add a member** by
    email and display name.
- **Non-goals:** invitations and sign-up; removing a member or changing a role (no database
  function exists); renaming an agent; token expiry; creating, renaming or deleting a workspace;
  the member's default visibility and display name; the audit log; colleagues' agents (the map
  shows them); any MCP change.
- **Anti-goals**
  - The token in a log line, a URL, browser storage, or the page's server-rendered HTML.
  - Deciding in app code who may create, revoke or add. The database functions decide.
  - A member's email address shown to anyone (the database does not expose it).

## Constraints found in the project

- `create_agent(p_workspace, p_name, p_provider, p_trust_tier)` returns `(agent_id, token)` once;
  only the hash is stored. It refuses agents and a workspace that is not the caller's.
- `revoke_agent(p_agent)` refuses agents and an agent that is not the caller's. Revocation takes
  effect at the agent's next sign-in; the MCP server signs in again at least hourly
  (`docs/security.md`).
- `add_member(p_hive, p_email, p_display_name)` is for the hive owner only, raises
  `no user with that email has signed up yet` for an unknown email, and fails on the unique
  `(hive_id, user_id)` for someone already in the hive. It also creates the member's `Main`
  workspace.
- `agents` is readable only by its own member, without the hash (`agents_select`, column
  grants). `members` rows are readable by every member of the hive; `workspaces` only by their
  own member.
- `provider` is free text and is what colleagues see on the map ("Ahmed, ChatGPT").
- A self-hosted agent's notes are held until the member releases them (the inbox lists them).
- The rail (`Shell`) takes `current` and the inbox count; pages load the count in parallel.

## Design

### 1. Loading (no schema change)

`loadSettings(db)`: the person's first hive (`id`, `name`), then in parallel:

- `members` of the hive: `id, display_name, role, user_id`, ordered by `created_at`. `user_id`
  is compared with the session's user to mark "you" and is not sent to the browser.
- `workspaces` (the person's own, by row-level security): `id, name`, ordered by `created_at`.
- `agents` (the person's own): the granted columns, newest first, **limit 200**.

An agent's status is worked out on the server at load time: `revoked` when `revoked_at` is set,
else `expired` when `expires_at` is in the past, else `active`. States: `ok`, `no-hive`, `error`.

### 2. The screen

The rail, then one glass card that fits the window; the card's content scrolls, the page does
not. Heading "Settings" with the hive's name. Two sections with mono labels.

- **Agents.** One line under the label: "An agent writes into one workspace as you. It can never
  change sharing, accept links or delete notes."
  - A row per agent: name, then provider · workspace · trust tier in words ("Vendor-hosted" /
    "Self-hosted, notes held for release"), then "Connected {date}" · "Last used {date}" or
    "Never used". Active agents first, then revoked and expired, dimmed, with the status in
    words.
  - **Revoke** on an active agent asks once in place ("Revoke {name}?" with **Revoke** and
    **Keep**), with the same half-second guard against a double click as the inbox's decline.
    Under the question: "It stops working within the hour."
  - **Connect an agent** opens a form in place: name (1 to 60 characters), workspace (a select,
    preselected when there is only one), provider (Claude, ChatGPT, Claude Code, Codex CLI,
    Other), trust tier (two radio options with one line each on what the tier means).
    **Create** and **Cancel**.
- **The token dialog** (modal, after a successful create):
  - "This token is shown once. Copy it now; it cannot be shown again."
  - The token in a mono field, selectable, with **Copy** (says "Copied" for two seconds).
  - "What to do with it": for Claude Code, the `.env` line `HIVE_AGENT_TOKEN=…` and the
    `claude mcp add` command with a placeholder for the path to the repository; a pointer to the
    instruction template in `docs/agent-integration.md` §5.
  - **Done** closes it. Escape and a click outside do **not** close it, so it cannot be lost by
    accident. The focus starts on the dialog's heading, not on Copy, so a held Enter copies
    nothing. On close the token is dropped from memory and the list is re-read.
- **Members.** A row per member: name, "you" where it applies, role. For the owner, **Add a
  member** opens a form in place: email, display name (1 to 60 characters), with the line "They
  need an account already. Inviting someone new comes later." Outcomes: added (the row appears);
  "Nobody with that email has an account yet."; "That person is already a member."; "That didn't
  work. Try again."
- A member who is not the owner sees the list and no form.

Look: Keystone glass tokens only; the same buttons, fields and labels as the vault and the
inbox. Keyboard: every action is a button or a field; the dialog traps focus and returns it to
"Connect an agent" on close.

### 3. Server actions

- `createAgent({ name, workspaceId, provider, trustTier })` → `{ ok: true, token }` or
  `{ ok: false }`. Checks: name trimmed, 1 to 60 characters; `workspaceId` a uuid; provider one
  of the five; tier one of the two. Calls `create_agent`. The token is returned to the caller
  and nowhere else: never logged, and an error log carries only the error's code and message.
- `revokeAgent(id)` → `{ ok }`. Uuid check, then `revoke_agent`.
- `addMember(email, name)` → `{ ok: true }` or `{ ok: false, reason }` with `reason` one of
  `no-account`, `already-member`, `failed`. Checks: an email shape (one `@`, no spaces, at most
  254 characters), name 1 to 60 characters. Finds the person's first hive, calls `add_member`.
  `no-account` when the database's message is the one above; `already-member` on error code
  `23505`; anything else `failed`.

All run as the person behind the session cookie. No permission logic in the app.

### 4. Development page and tests

- `/dev/settings` shows the screen on sample data without an account: default (owner, three
  agents of which one revoked, two workspaces, three members), `?member=1` (not the owner),
  `?fail=1` (every action fails), `?none=1` (no agents yet), `?reason=no-account` and
  `?reason=already-member` for the add form.
- **Database tests** (`tests/sharing-rules.test.mjs`, tests only): a member who is not the owner
  cannot add a member; an unknown email is refused with the known message; adding the same person
  twice is refused; an agent can call neither `add_member`, `create_agent` nor `revoke_agent`;
  a person cannot revoke a colleague's agent or create one in a colleague's workspace. Any of
  these already covered is not repeated.
- **Unit tests** (Vitest): the argument checks, what each action sends, the mapping of
  `add_member`'s failures, the loader's states and status logic, that no log call ever receives
  the token.
- **Browser tests** (Playwright, on `/dev/settings`): create shows the dialog with the token and
  the list gains the agent; Copy puts the token on the clipboard; Escape does not close the
  dialog and Done does; after Done the token is nowhere in the page; revoke needs the second
  step and ignores a double click; a member who is not the owner has no add form; each add
  outcome; the page does not scroll at 1100 × 560; the rail marks Settings.

## Performance and data-fetching budget

- **First paint:** the hive lookup, then three small reads in parallel (members, workspaces,
  agents) plus the inbox count the rail already asks for. Agents are capped at 200; members and
  workspaces are per hive and per person, in the tens.
- **Create, revoke, add:** one database call, then one refresh of the page. Opening a form, the
  revoke question and the dialog are client state: 0 round trips.
- `agents` has no index on `member_id`; the table holds a handful of rows per member and the
  read is filtered by row-level security. Accepted for now; an index belongs to the slice that
  adds a migration next.
- No tabs, filters or sorts.

## Independent units (for the plan)

1. The contract: types, sentences, sample data, the rail entry (`web/src/settings/`,
   `web/src/shell/`).
2. Loading, checks, server actions (`web/src/app/settings/`) and the database tests (`tests/`).
   Needs 1.
3. The screen, the development page and the browser tests. Needs 1.
4. The real page and docs. Needs 2 and 3.

2 and 3 share no file.

## Known gaps (accepted)

- **An owner can learn whether an email has an account** from the add form's answer. The
  database function already says so; the screen shows it only to the owner.
- No token expiry; no rename; no removing a member; no role change.
- A revoked agent keeps working until its next sign-in, up to an hour.
- The token passes through the server action's response to the browser that asked. That is the
  one place it is ever sent.
- Old revoked agents accumulate in the list (200 shown, agents still in use first).
- While the token dialog is open, reload and tab close ask first and browser Back is held on
  the page; the page is locked while the create call runs. Back during that short wait is not
  held.
- No test proves the list is re-read from the server after an action: the sample page updates
  its own data. Tried by hand on the real page.

## Review focus

- The token: never in a log, a URL, storage, server-rendered HTML, or the page after Done.
- The dialog cannot be dismissed by accident.
- Revoke cannot happen in one gesture.
- No permission logic in `web/`; a non-owner's forged `addMember` call is refused by the
  database.
