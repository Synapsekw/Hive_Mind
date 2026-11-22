# Bringing up a hosted database

How to take an empty Supabase project to "one hive, one owner, one agent token". First done on the
dev project `tokyttkztrkjvkaksdnh` on 2026-11-22. Design notes:
[2026-11-22-db-bringup-design.md](superpowers/specs/2026-11-22-db-bringup-design.md).

## Current state of the dev project

- Migrations `20261120000001_schema` and `20261120000002_sharing_rules` are applied and recorded
  under those versions.
- One hive (`Synapse`), one owner member (`Danijel`), one workspace (`Main`), one agent (`Claude`,
  provider `claude`, trust tier `vendor`).
- The agent token is in the owner's local `.env` as `HIVE_AGENT_TOKEN`. Only its hash is stored in
  the database, so a lost token cannot be recovered: revoke the agent and create a new one.

## Steps

1. **Create the owner's account.** Dashboard → Authentication → Users → Add user → Create new
   user, with Auto Confirm ticked. The person does this themselves; a password never goes through
   an agent.

2. **Apply the migrations**, in file-name order, unchanged.

   - With the CLI (preferred once it is installed): `supabase link --project-ref <ref>` then
     `supabase db push`.
   - With the Supabase MCP: `apply_migration` once per file, with the file's contents and its name
     without the stamp (`schema`, `sharing_rules`). The tool records its own timestamp as the
     version, so re-stamp the rows to match the repo, or a later `db push` will try to apply the
     files again:

     ```sql
     update supabase_migrations.schema_migrations
        set version = '20261120000001' where name = 'schema';
     update supabase_migrations.schema_migrations
        set version = '20261120000002' where name = 'sharing_rules';
     ```

     This is the one place the history table is touched by hand, and only to make it say what is
     true. Never do it to hide a difference between the files and the database.

3. **Create the hive as the owner.** `create_hive` refuses a caller with no identity. In SQL, set
   the owner's identity for the transaction first:

   ```sql
   begin;
   set local role authenticated;
   select set_config('request.jwt.claims',
     '{"sub":"<the user id from auth.users>","role":"authenticated"}', true);
   select public.create_hive('<hive name>', '<display name>');
   commit;
   ```

4. **Create the agent** the same way, against the workspace `create_hive` made:

   ```sql
   select * from public.create_agent('<workspace id>', 'Claude', 'claude');
   ```

   The token is returned once. Put it in `.env` as `HIVE_AGENT_TOKEN` and nowhere else.

5. **Verify through the public API** with the anon key from `.env`:

   | Call                                               | Expected                           |
   | -------------------------------------------------- | ---------------------------------- |
   | `POST /rest/v1/rpc/agent_login` with the token     | 200, one row with the hive's ids   |
   | `POST /rest/v1/rpc/agent_login` with a wrong token | 400, "unknown, expired or revoked" |
   | `GET /rest/v1/hives`, `members`, `notes`           | 200, `[]`                          |
   | `GET /rest/v1/agents`                              | 401, permission denied             |
   | `POST /rest/v1/rpc/create_hive`                    | 401, permission denied             |

## What this does not prove

`agent_login` works with the anon key, but the MCP server's next step — signing its own JWT with the
project secret and reading as the member — has still not run against this database. That is T2 of
the [Phase 1 plan](superpowers/plans/2026-11-21-local-end-to-end.md).
