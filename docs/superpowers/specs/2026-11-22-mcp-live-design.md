# MCP server on the live database — short design

T2 of [Phase 1 — Local end to end](../plans/2026-11-21-local-end-to-end.md).

## Intent

Prove the MCP server against a real Supabase project instead of assuming it works, and leave a test
that repeats the proof. Until now the server had only been typechecked.

## Goals, non-goals, anti-goals

- **Goals:** every one of the six tools called through a real MCP client against the hosted dev
  project; the agent sign-in confirmed; the "agents never delete, never set sharing" rule confirmed
  on real Supabase, not only in PGlite; a repeatable `pnpm test:live`.
- **Non-goals:** connecting the owner's Claude (T3), replacing the legacy-secret sign-in
  ([gotcha 06](../../../vault/decisions/2026-11-22-gotcha-06-agent-sign-in-rests-on-the-legacy-jwt-secret.md)),
  the local Docker stack.
- **Anti-goals:** test notes left in the owner's hive; a live test that runs, or fails, in CI where
  there is no database; permission logic added to `mcp/` to make a test pass.

## Approaches

1. **Test in the owner's dev hive, clean up as the owner — picked by Danijel.** No setup. Notes go
   under `_integration-test/<run id>/`; since agents cannot delete, the test signs in as the owner
   with the server secret to remove them, and sweeps leftovers from crashed runs.
2. **A separate test account and hive.** Never touches the real hive, but needs a second user and a
   second token.
3. **Local stack only.** The cleanest isolation, not available until Docker is installed.

## Design

- `tests/mcp.integration.test.mjs` spawns `mcp/dist/index.js` over stdio with the MCP SDK's client
  (resolved from `mcp/`'s own dependencies, so the root installs nothing new) and checks: the tool
  list, `hive_overview`, `hive_write` (create then update), `hive_read` (path, id, missing),
  `hive_append`, `hive_search`, `hive_propose_link`, refusal of an agent identity that deletes or
  shares, invisibility to a signed-out caller, and refusal to start with a wrong token.
- It skips itself unless the four `.env` values are present and the server is built, so
  `pnpm test` and CI are unaffected. `pnpm test:live` builds, loads `.env` and runs it.
- Bugs found are fixed at the root: server bugs in `mcp/`, database bugs as a new migration plus a
  sharing-rules test.

## Outcome

All ten checks passed on the first live run; nothing in `mcp/` or the migrations needed changing.

## Plan, execution DAG and budget

One chain: write the test → run it live → fix → re-run → paperwork. Each step consumes the previous
one's result, so there are no parallel batches and the critical path is the whole list. No UI; a
run makes about fifteen small requests, all bounded by the tools' own limits.
