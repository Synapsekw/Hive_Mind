# Second member proof — short design

T6 of [Phase 1 — Local end to end](../plans/2026-11-21-local-end-to-end.md), the last task of the
phase.

## Intent

The demo shows the sharing rules working between two people in an in-process database with stubbed
auth. This shows the same thing on real Supabase, through the real MCP server, before any colleague
is invited.

## Goals, non-goals, anti-goals

- **Goals:** two members of one hive, each with an agent; proof that private stays private, that
  sharing opens a note, and that a link opens two private notes only after both people accept; the
  proof repeatable with one command.
- **Non-goals:** invitations, a UI for accepting links, removing a member.
- **Anti-goals:** a proof that only works by bypassing row-level security; test notes or links
  left in the owner's hive; a real person's email used for a test account.

## Approaches

1. **A live test with two MCP servers — picked.** One server per agent token, driven by real MCP
   clients, with the people's decisions (share, accept) made over the REST API as each person. It
   exercises exactly the path colleagues will use and can be re-run after any change to the rules.
2. **A manual walkthrough recorded in a session note** (what the plan asked for). Proves it once
   and never again.
3. **Two headless Claude sessions.** Closest to real use, but slow, costly and not deterministic
   enough to assert on.

## Design

- **The second member** is a standing test account, `test-colleague@hive-mind.invalid`, display
  name `Test Colleague`, with no password. It was created by SQL: the project's sign-up would have
  sent a confirmation email to a made-up address. The owner added it with `add_member`, and it
  created its own agent with `create_agent`; the token is `HIVE_AGENT_TOKEN_2` in `.env`.
- **`tests/two-members.integration.test.mjs`** (skips itself without the second token):
  1. each agent writes a private note; neither agent, nor the other person directly, can see the
     other's;
  2. an agent's attempt to share is refused by the database; after the owner shares the note with
     the group, the other agent finds and reads it but the other person cannot edit it;
  3. an agent proposes a link between the two private notes; no agent can accept; one person
     accepting is not enough; after both accept, each agent reads the other's note and nothing
     more;
  4. neither agent can write into the other's workspace;
  5. the second member sees none of the owner's other notes.
- **Sharing and accepting are done as the people,** signed with the server secret, and only on
  notes the test created under `_integration-test/two-<run>/`. Cleanup deletes those notes as each
  owner; their links go with them.
- **`pnpm test:live`** now runs both live files, one after the other, because the first file's
  cleanup sweeps every `_integration-test/` note in the owner's workspace.

## Outcome

All five checks passed on the first run against the hosted project; no rule needed changing.

## Plan, execution DAG and budget

One chain: create the account → add the member → mint the token → write and run the test → docs.
No parallel batches. No UI; a run makes about forty small requests.
