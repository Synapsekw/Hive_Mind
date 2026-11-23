# Bringing up a hosted database

How to take an empty Supabase project to "one hive, one owner, one agent token". First done on the
dev project `tokyttkztrkjvkaksdnh` on 2026-11-22. Design notes:
[2026-11-22-db-bringup-design.md](superpowers/specs/2026-11-22-db-bringup-design.md).

## Current state of the dev project

- Migrations `20261120000001_schema`, `20261120000002_sharing_rules` and
  `20261122063919_file_storage` are applied and recorded under those versions. The third adds a
  private `files` storage bucket.
- Migration `20261122083415_map_graph` is applied too, through the Supabase MCP and re-stamped
  like the earlier ones. It adds `map_graph` and `note_topic` for the web app's map.
- Migration `20261122115431_folder_rules_by_path` is applied and recorded under that version.
- Migration `20261123071625_inbox` is applied (2026-11-23) and recorded under that version. It
  adds `inbox` and `inbox_count` for the web app's inbox.
- Migration `20261123105237_invitations` is applied (2026-11-23) and recorded under that version.
  It adds the `invitations` table and `invite_member`, `revoke_invitation` and
  `claim_invitations` for inviting a member from Settings.
- One hive (`Synapse`), one owner member (`Danijel`), one workspace (`Main`), one agent (`Claude`,
  provider `claude`, trust tier `vendor`).
- The agent token is in the owner's local `.env` as `HIVE_AGENT_TOKEN`. Only its hash is stored in
  the database, so a lost token cannot be recovered: revoke the agent and create a new one.
- The Edge Function `agent-session` is deployed, with JWT verification off. Its signing key is
  the function secret `AGENT_SIGNING_JWK`, and the same key is imported under Project Settings →
  JWT Keys as a standby key (see [Set up agent sign-in](#set-up-agent-sign-in)).
- The legacy JWT secret is not revoked yet. Nothing in the repo reads it.

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

   The token is returned once. Put it in `.env` as `HIVE_AGENT_TOKEN` and nowhere else. This
   is for the first agent of a new project only; with the web app running, agents are created
   and revoked, and members invited, in **Settings**.

5. **Verify through the public API** with the anon key from `.env`:

   | Call                                               | Expected                           |
   | -------------------------------------------------- | ---------------------------------- |
   | `POST /rest/v1/rpc/agent_login` with the token     | 200, one row with the hive's ids   |
   | `POST /rest/v1/rpc/agent_login` with a wrong token | 400, "unknown, expired or revoked" |
   | `GET /rest/v1/hives`, `members`, `notes`           | 200, `[]`                          |
   | `GET /rest/v1/agents`                              | 401, permission denied             |
   | `POST /rest/v1/rpc/create_hive`                    | 401, permission denied             |

6. **Set up agent sign-in**, described next. Without it the token is valid but no agent can use
   it.

## Set up agent sign-in

An agent does not sign its own identity. The MCP server sends its agent token to the Edge
Function `agent-session`, which asks the database who the token belongs to and answers with an
identity that lasts one hour, signed with a key of our own. The setup is done once per project,
by the project owner:

```sh
scripts/setup-agent-signing.sh <project-ref>
```

Run it in your own terminal, not through an AI assistant: it makes a private key, and that key
must not enter a chat. The script refuses to run without a terminal. It needs the Supabase CLI,
signed in (`supabase login`), and Node; it does not need Docker. It does four things:

1. Makes an ES256 key in a private temporary folder and prints the key's id (`kid`). The id is
   not secret; the key itself is never printed.
2. Stores the key as the function secret `AGENT_SIGNING_JWK`.
3. Stops while you import the same key in the dashboard: Project Settings → JWT Keys → create a
   standby key → import an existing private key → paste the content of the file the script
   names (on a Mac it offers to copy it to the clipboard, and clears the clipboard afterwards).
   The standby key must show the id the script printed. **Do not rotate to it**: as a standby
   key it is already published with the project's public keys, which is all the database needs
   to accept what the function signs. Rotating would make Supabase Auth sign people's sessions
   with it too.
4. Deploys the function (`supabase functions deploy agent-session --use-api --no-verify-jwt`)
   and deletes the temporary folder. JWT verification is off because the caller has no identity
   yet; the agent token is the credential.

Running the script again makes a new key. Import the new one as well and remove the old standby
key, or the function signs with a key the database does not know. If only the deploy failed, do
not run the script again; run the deploy command it prints.

After that, a machine that runs an agent needs three values in `.env` and nothing else:
`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `HIVE_AGENT_TOKEN`. Remove `SUPABASE_JWT_SECRET` from
any `.env` that still has it.

**The legacy JWT secret.** Do not revoke it during this setup. A build from before this change
signs agent identities with that secret and stops working the moment it is revoked. Revoke it
(dashboard → Project Settings → JWT Keys) only once every machine that runs an agent, the
importer or the live tests runs a build from after this change. Until it is revoked it can
still sign an identity for any member, so keep it off every machine.

**If the function is not deployed**, the MCP server fails at its first call with a sign-in error
that names `agent-session` and this page, and
`POST <project URL>/functions/v1/agent-session` answers 404. If the function is deployed but the
key was not stored, it answers 500, "sign-in is not set up". If the key was stored but not
imported in the dashboard (or a newer key was stored since), the function answers 200 and the
database then refuses the identity: every tool call fails with a JWT error.

To check by hand, with the publishable key as the `apikey` header:

| Call                                                                          | Expected                                  |
| ----------------------------------------------------------------------------- | ----------------------------------------- |
| `POST /functions/v1/agent-session` with `{ "token": "<the agent token>" }`    | 200, an `access_token` and the hive's ids |
| `POST /functions/v1/agent-session` with a wrong token of 20 to 200 characters | 401, "unknown, expired or revoked token"  |

## Run the web app

The web app needs two public values from Project Settings → API: the project URL and the
publishable key. Put them in `web/.env.local` (copy `web/.env.example`) and run `pnpm dev:web`.
`NEXT_PUBLIC_*` values are baked in when the app is built, so rebuild after changing them.

- **Password.** Set one on the member's account in the dashboard (Authentication → Users). A
  password never goes through an agent.
- **Emailed links.** Add `http://localhost:3000/**` to the allowed redirect URLs (Authentication
  → URL Configuration), or the link is refused.
- **Invitations.** Two settings under Authentication must both be on:
  - [ ] **Allow new users to sign up**, so an invited person's first "Email me a link" creates
        their account.
  - [ ] **Confirm email**, so an account counts as that person only after they have proved the
        address. With it off, someone who knows an invited address could join in that person's
        place. Nothing in the app can check this setting; see
        [security.md](security.md#3-identity-and-tokens).

## What is proven, and what is not

- `pnpm test:live` runs its checks against the hosted project: the MCP server signs in with an
  agent token through `agent-session` and calls every tool as the member, and two members'
  agents keep private notes private until a person shares them or both accept a link. It also
  calls `map_graph` as a member and as an agent, which is refused, and checks that a note an
  agent writes into a folder its member has shared is readable by the second member at once. The
  function refuses a wrong token, and the database refuses an identity signed with a key it
  does not know.
- The checks that act as a person sign in with an email and password from `.env`
  (`HIVE_PERSON_EMAIL`, `HIVE_PERSON_PASSWORD`, and the `_2` pair for the second member) and are
  skipped, with the reason printed, when those are absent. Use test accounts for them.
- Signing in to the web app through the browser, and the map it then draws, are checked by hand.
  No automated test signs in to the hosted project through the browser.
