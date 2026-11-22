# Hosted database bring-up — short design

T1 of [Phase 1 — Local end to end](../plans/2026-11-21-local-end-to-end.md), hosted half only.

## Intent

Take the hosted dev project `tokyttkztrkjvkaksdnh` from empty to usable, so T2 (the MCP server's
first run against a live database) has something to connect to: both migrations applied, one hive
owned by Danijel, one agent token for his Claude in `.env`.

## Goals, non-goals, anti-goals

- **Goals:** the hosted schema is byte-for-byte the repo's migrations; the migration history uses
  the repo's version stamps; the hive and the agent are created under the owner's identity so the
  database's own rules run; the result is verified through the public API; the steps are written
  down so a fresh project can be brought up the same way.
- **Non-goals:** the local Docker stack (Docker is not installed yet), any change to `mcp/` or to
  the migrations, running the MCP server (T2).
- **Anti-goals:** a schema changed by hand that the repo cannot reproduce; the agent token or any
  key in a commit, a log or a doc.

## Approaches

1. **Supabase MCP (`supabase-dev`) from the session — picked.** Works today with no extra
   installs. Its `apply_migration` stamps its own timestamp, so the two history rows are re-stamped
   to the repo's versions afterwards. The token passes through the session once on its way to
   `.env`.
2. **`supabase db push` with the CLI.** The cleanest history, but the CLI and the database password
   are not set up on this machine. This is the route to use once they are; approach 1 leaves the
   history in the state `db push` expects.
3. **Paste the SQL in the dashboard editor.** No tooling, but it records no migration history and
   is exactly the click-ops the working agreement forbids.

## Design

1. The owner creates their account in the dashboard (Authentication → Add user). No password
   passes through an agent.
2. Apply `20261120000001_schema.sql` and `20261120000002_sharing_rules.sql` unchanged; re-stamp the
   history rows to those versions; compare a whitespace-insensitive hash of what was recorded with
   the files.
3. Call `create_hive` and `create_agent` with the owner's identity set as the request's JWT claims,
   not as an admin bypass.
4. Write the token into `.env` (git-ignored) without echoing it.
5. Verify through the REST API with the anon key: `agent_login` accepts the token and rejects a
   wrong one; a signed-out caller reads nothing and cannot call `create_hive`.
6. Commit a runbook ([hosted-db-bringup.md](../../hosted-db-bringup.md)) and update the README and
   the north-star.

## Plan, execution DAG and budget

One sequential task: every step consumes the previous step's output (account → schema → hive →
agent → token → verification), so there is nothing to run in parallel and the critical path is the
whole list. No UI and no new queries, so there is no data-fetching budget to state. The repo change
is documentation only; the four gates still run before merge.
