# Bringing up a hosted database

How to take an empty Supabase project to "one hive, one owner, one agent token". First done on the
dev project `tokyttkztrkjvkaksdnh` on 2026-11-22. Design notes:
[2026-11-22-db-bringup-design.md](superpowers/specs/2026-11-22-db-bringup-design.md).

Putting the web app online and connecting Claude or ChatGPT to it is in
[Hosting and the connector](#hosting-and-the-connector). Emailing invitations, and closing
sign-ups afterwards, is in [Invitation email](#invitation-email). Erasing hives their owners
deleted is in [Hive deletion](#hive-deletion).

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
- Migration `20261123174149_emailed_invitations` is applied (2026-11-24) with
  `supabase db query --linked -f <file>` and recorded under that version. The Edge Function
  `invite-email` is deployed, with JWT verification off, and its secrets `RESEND_API_KEY`,
  `HIVE_INVITE_FROM` and `HIVE_SITE_URL` are set. An invitation was sent, opened and joined by
  hand on 2026-11-24, with and without another account signed in. The project's own mail goes
  through Resend (SMTP), "Confirm email" is on, the email code is 10 digits and lives 86400
  seconds, the minimum password length is 10, and **"Allow new users to sign up" is off**: an
  uninvited address is refused with `signup_disabled`, and an invitation still goes out and can
  be joined (checked 2026-11-24).
- Migration `20261123123845_note_delete_audit` is applied (2026-11-23) and recorded under that
  version. It adds the `notes_deleted_audit` trigger, which writes a deleted note to the audit
  log.
- Migration `20261123150712_connected_apps` is applied (2026-11-23) and recorded under that
  version. It adds connected apps (`connect_app`, `connector_login`) and makes the database
  refuse an app's pass everywhere else. It was applied with
  `supabase db query --linked -f <file>` in one transaction, so the file ran byte for byte.
- Migration `20261124074246_link_behaviours` is applied (2026-11-24) with
  `supabase db query --linked -f <file>` in one transaction and recorded under that version. It
  allows one link per pair of notes in either direction, makes a decline final, and adds
  `unlink` and `note_links` for the vault. Checked before applying: no pair of notes had link
  rows in both directions (the new unique index refuses them, so on another project look for
  such pairs first; which row to keep is the owner's decision).
- Migration `20261124082437_hive_cap` is applied (2026-11-24) with
  `supabase db query --linked -f <file>` in one transaction and recorded under that version. It
  replaces `create_hive`: at most 5 hives owned by one person, both names 1 to 60 characters
  after trimming, and a `hive.created` entry in the audit log.
- Migration `20261124091833_hive_deletion` is applied (2026-11-24) in one transaction and
  recorded under that version. The Edge Function `purge-hives` is deployed with JWT
  verification off, `scripts/setup-hive-purge.sh` has been run (`pg_cron` and `pg_net` on, the
  secret in the function's secrets and the database's secret store, job `purge-hives` daily at
  03:17 UTC). Checked: a call without the secret or with a wrong one gets 401; one run started
  through the job's own command answered `{"ok":true,"purged":0,"failed":0}`. Not yet seen on
  this project: a real erase, since no hive has been due.
- Migration `20261124110155_workspace_cap` is **not applied yet**. It lets a member have at
  most 20 workspaces and requires a workspace name of 1 to 60 characters after trimming. Until
  it is applied the database enforces neither.
- The Edge Function `mcp` (the remote connector) is deployed, with JWT verification off. It uses
  the same two secrets as `agent-session` and needs no other. The deployed `agent-session` is
  still the build from before its signing code moved to `_shared/`; behaviour is the same.
- One hive (`Synapse`), one owner member (`Danijel`), one workspace (`Main`), one agent (`Claude`,
  provider `claude`, trust tier `vendor`).
- The agent token is in the owner's local `.env` as `HIVE_AGENT_TOKEN`. Only its hash is stored in
  the database, so a lost token cannot be recovered: revoke the agent and create a new one.
- The Edge Function `agent-session` is deployed, with JWT verification off. Its signing key is
  the function secret `AGENT_SIGNING_JWK`, and the same key is imported under Project Settings →
  JWT Keys as a standby key. The project's publishable key is the function secret
  `HIVE_PUBLISHABLE_KEY` (see [Set up agent sign-in](#set-up-agent-sign-in)).
- The legacy JWT secret is not revoked yet, and the legacy API keys are not disabled. Nothing in
  the repo reads the secret.

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
signed in (`supabase login`), and Node; it does not need Docker. It does five things, in this
order:

1. Takes the project's publishable key (Project Settings → API Keys; it starts with
   `sb_publishable_`). It uses `SUPABASE_ANON_KEY` from the environment if that is set, and
   asks otherwise. The key is public. A key that starts with `eyJ` is the legacy anon key; the
   script warns and asks before it accepts one.
2. Makes an ES256 key in a private temporary folder and prints the key's id (`kid`). The id is
   not secret; the key itself is never printed.
3. Stops while you import that key in the dashboard: Project Settings → JWT Keys → create a
   standby key → import an existing private key → paste the content of the file the script
   names. On a Mac it offers to copy the key to the clipboard; Universal Clipboard shares the
   clipboard with your nearby Apple devices, and the script empties it afterwards only if it
   still holds the key. It then asks which id the dashboard shows for the new standby key. If
   that differs from the one it printed, type it: the function writes the id in every
   identity, and it must be the one the project knows. **Do not rotate to the standby key**:
   as a standby key it is already published with the project's public keys, which is all the
   database needs to accept what the function signs. Rotating would make Supabase Auth sign
   people's sessions with it too.
4. Only then stores the two function secrets in one call: `AGENT_SIGNING_JWK` (the key) and
   `HIVE_PUBLISHABLE_KEY`. This is the first step that changes the project; stopping the script
   before it (Ctrl-C) leaves the function as it was.
5. Deploys the function (`supabase functions deploy agent-session --use-api --no-verify-jwt`)
   and deletes the temporary folder. JWT verification is off because the caller has no identity
   yet; the agent token is the credential.

Running the script again makes a new key. The function keeps signing with the old one until the
new one is imported and stored, so agents keep working throughout; remove the old standby key
in the dashboard afterwards. If you stop the script after importing a key but before it is
stored, that standby key is unused: remove it. If only the deploy failed, do not run the script
again; run the deploy command it prints.

**The signing key is as powerful as the service-role key.** The database accepts whatever role
a token signed with it claims, including `service_role`. It exists in two places only, the
function's secrets and the project's JWT keys, and function secrets are readable by every Edge
Function of the project; see [security.md](security.md#3-identity-and-tokens).

After that, a machine that runs an agent needs three values in `.env` and nothing else:
`SUPABASE_URL`, `SUPABASE_ANON_KEY` (the publishable key) and `HIVE_AGENT_TOKEN`. Remove
`SUPABASE_JWT_SECRET` from any `.env` that still has it.

**The legacy JWT secret and the legacy API keys.** Do not revoke the secret or disable the
legacy keys during this setup. Two things must hold first:

- Every machine that runs an agent, the importer or the live tests runs a build from after this
  change. A build from before it signs agent identities with that secret and stops working the
  moment it is revoked.
- The function is using `HIVE_PUBLISHABLE_KEY` (set by the script), not the legacy anon key.
  The Edge runtime's own `SUPABASE_ANON_KEY` is the legacy anon key, which stops working with
  the legacy secret; a function that still calls the database with it then answers 502 to
  every sign-in.

Then revoke the secret under dashboard → Project Settings → JWT Keys. Until it is revoked it
can still sign an identity for any member, so keep it off every machine.

**If the function is not deployed**, the MCP server fails at its first call with a sign-in error
that names `agent-session` and this page, and
`POST <project URL>/functions/v1/agent-session` answers 404. If the function is deployed but the
secrets were not stored, it answers 500, "sign-in is not set up". If the key was stored but not
imported in the dashboard, or under another id than the dashboard shows, the function answers
200 and the database then refuses the identity: every tool call fails with a JWT error.

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
- **Invitations.** Inviting in Settings saves the invitation in the database and then asks the
  Edge Function `invite-email` to email it. That needs the function, its secrets and the
  project's mail settings: see [Invitation email](#invitation-email). On a project without
  them the invitation is still saved, and Settings answers "Invitation saved, but the email
  could not be sent. Use Send again."

## Hosting and the connector

This puts the web app on the internet and lets a colleague connect Claude or ChatGPT by pasting
one address. Do the four parts in this order. In what follows, `<site>` is the web app's address
without a slash at the end, and `<project-ref>` is the Supabase project's short name
(`tokyttkztrkjvkaksdnh` for the dev project).

Nothing secret goes to Netlify. The signing key and the service-role key stay where they are.

### 1. Netlify: host the web app

1. Create a Netlify account and choose **Add new site → Import an existing project**. Pick
   GitHub and the Hive Mind repository.
2. Leave the build settings as Netlify fills them in. They come from `netlify.toml` in the repo:
   base directory empty, build command `pnpm --filter @hive-mind/web build`, publish directory
   `web/.next`, Node 22. Do not type other values over them.
3. Add three environment variables (Site configuration → Environment variables), the same for
   every deploy:

   | Variable                        | Value                                                |
   | ------------------------------- | ---------------------------------------------------- |
   | `NEXT_PUBLIC_SUPABASE_URL`      | `https://<project-ref>.supabase.co`                  |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | The publishable key (starts with `sb_publishable_`)  |
   | `HIVE_CONNECTOR_URL`            | `https://<project-ref>.supabase.co/functions/v1/mcp` |

   All three are public values. The two `NEXT_PUBLIC_*` ones are baked in when the app is built,
   so start a new deploy after changing them.

4. Set the branches (Site configuration → Build & deploy → Branches and deploy contexts):
   production branch `main`, and a branch deploy for `develop`. The `develop` deploy is the
   **test site**. Its address is `https://develop--<site-name>.netlify.app`; the `main` site is
   `https://<site-name>.netlify.app`.
5. Until this work has been promoted to `main`, the `main` deploy has no `netlify.toml` and may
   fail. That is expected. Use the test site.
6. Open `<site>/login` on the test site. The sign-in page should appear.

### 2. Supabase: the dashboard switches

Done once, by the project owner, in the Supabase dashboard. `supabase/config.toml` holds the same
settings for the local stack.

1. **Authentication → OAuth Server.**
   - [ ] Enable the OAuth server.
   - [ ] Dynamic client registration: **off**, and it stays off. With it on, any program can
         register itself, and an app a member approves receives an ID token that Supabase Auth
         accepts for a password change (proven 2026-11-23, gotcha 07 in `vault/decisions/`).
         Claude and ChatGPT are registered by hand under **Authentication → OAuth Apps**.
   - [ ] Authorization path: `/oauth/consent`.
2. **Authentication → URL Configuration.**
   - [ ] **Site URL**: `<site>`. Supabase sends a person to the Site URL plus the authorization
         path, so this decides which site shows the approval window. Only one site can be the
         Site URL at a time.
   - [ ] **Redirect URLs**: add `<site>/auth/confirm`, for the test site and for the `main` site.
         Keep `http://localhost:3000/**` for local work. If an emailed sign-in link opens the
         site's front page and not the approval window, the entry did not match: add `<site>/**`.
3. **During hand testing the Site URL is the `develop` test site. At promotion to `main` it
   moves to the `main` site**, and from then on the connector address people paste is the `main`
   one. A connector added against the test site stops working at that point and is added again
   with the new address.
4. Leave **Confirm email** on; it stays on for good. Do not touch **Allow new users to sign up**
   here: it is switched off as the last step of [Invitation email](#invitation-email), and not
   before.

### 3. Deploy the connector function

The migration `connected_apps` must be applied first (step 2 of [Steps](#steps)); the function
calls `connector_login`, which that migration adds.

```sh
supabase functions deploy mcp --use-api --no-verify-jwt --project-ref <project-ref>
```

It needs the Supabase CLI, signed in (`supabase login`); it does not need Docker. The function
reuses the two secrets that agent sign-in already stored, `AGENT_SIGNING_JWK` and
`HIVE_PUBLISHABLE_KEY`. There is no new secret and no key to make, so
[Set up agent sign-in](#set-up-agent-sign-in) must have been done once, and is not repeated.

To check by hand:

| Call                                                      | Expected                                                                 |
| --------------------------------------------------------- | ------------------------------------------------------------------------ |
| `POST <site>/mcp` with no `Authorization` header          | 401, and a `WWW-Authenticate` header that names `resource_metadata`      |
| `GET <site>/.well-known/oauth-protected-resource`         | 200, JSON with `resource` = `<site>/mcp` and one `authorization_servers` |
| `POST https://<project-ref>.supabase.co/functions/v1/mcp` | 401, "sign in to the hive"                                               |

`HIVE_SITE_URL=<site> pnpm test:live` runs the first two and also asks Supabase Auth for its
discovery answer. The address people use is always `<site>/mcp`; the function's own address is
not one to hand out.

### 4. Connect an app

The address is the same for everyone: `https://<site>/mcp`. The person connecting must already
be a member of the hive (invited in **Settings**).

Apps do not register themselves (see the switches above), so the owner registers each kind of
app once under **Authentication → OAuth Apps** and hands its **client ID** to colleagues with the
address. A client ID is not a secret.

| App     | Client type | Redirect URI                                          | Client ID on the dev project           |
| ------- | ----------- | ----------------------------------------------------- | -------------------------------------- |
| Claude  | Public      | `https://claude.ai/api/mcp/auth_callback`             | `c5b56322-1148-4076-bee7-5f918cd44656` |
| ChatGPT | Public      | the **Callback URL** ChatGPT's form shows (see below) | `6cfa3723-978c-4a2c-8398-8a91dc610584` |

Both proven by hand on 2026-11-23: public clients, no secret, rated `vendor`.

ChatGPT's callback address is not the same for everyone. Supabase Auth does not offer issuer
identification, so ChatGPT uses an address of the form `https://chatgpt.com/connector/oauth/<id>`
that belongs to one ChatGPT account. The owner adds each colleague's address to the ChatGPT
entry's redirect URIs. The one registered so far is the owner's own. An address that is not
registered is refused with `invalid redirect_uri`.

**Claude (web or desktop)**

1. Open **Settings → Connectors**.
2. Choose **Add custom connector**.
3. Give it a name, for example `Hive Mind`, and paste `https://<site>/mcp`. Open **Advanced
   settings** and paste the Claude client ID into **OAuth Client ID**; leave the secret empty.
   Add it. Without the client ID Claude answers "Automatic client registration isn't
   supported".
4. Choose **Connect**. A Hive Mind window opens.
5. Sign in with your email. If you ask for an emailed link, it opens in a new tab, and the
   approval continues in that tab.
6. The window names the app that is asking and the address it returns to. Pick a workspace.
7. Click **Approve**. You are sent back to Claude, which now lists the hive tools.

**ChatGPT**

1. Open **Plugins**, then **Add → Add custom MCP server** (it needs developer mode and a plan
   that allows custom servers).
2. Name `Hive Mind`, server URL `https://<site>/mcp`, authentication **OAuth**.
3. Open **Advanced OAuth settings**. Registration method **User-Defined OAuth Client**. Send the
   owner the **Callback URL** shown there, and wait until it is registered.
4. Paste the ChatGPT client ID into **OAuth client ID**. Type it after the form has finished
   "Discovering OAuth settings", or the form clears it. Leave the secret empty; token endpoint
   auth method `none`.
5. Under **Default scopes** leave only `email` and `offline_access` ticked, and switch **OIDC
   enabled** off. ChatGPT then asks for no ID token, the token gotcha 07 is about.
6. Tick the notice, **Create as a plugin**, then **Continue to Hive Mind**: sign in, pick a
   workspace, **Approve**.

The names of these menus change between versions of the two apps. What stays the same is the
address and the three things you do in the window.

**What the app can do.** Six tools work through the connector: `hive_overview`, `hive_search`,
`hive_read`, `hive_write`, `hive_append` and `hive_propose_link`. `hive_save_file` works only
with the local server (Claude Code, or Claude Desktop's local config), because it reads a file
from the computer the agent runs on. The app reads what you can read and writes only into the
workspace you picked. It cannot change sharing, accept a link or delete a note.

**An app we do not know.** The database decides how far an app is trusted from every address
the app registered when it signed up with the sign-in server, and checks again on every call.
An app with any address other than an `https` one on Claude's or ChatGPT's own hosts is
`self_hosted`: it reads shared notes only and its writes are held until you release them. The
address shown in the window is for you to read; it does not decide this.

**To disconnect.** In Hive Mind, open **Settings** and revoke the agent named after the app (its
provider reads `Connected app`). That cuts the app off at once: its next call is refused.
Settings also ends the app's sign-in at Supabase, so the app is not handed a new pass.
Removing the connector inside Claude or ChatGPT alone does not revoke anything.

**To connect again.** A revoked app is not switched back on in Settings. Remove the connector
inside the app, add it again with the same address and client ID, and approve in the window.

**Deleting an entry under OAuth Apps** cuts off everyone who connected through it: the database
refuses a deleted app. Their agents stay listed in Settings until each person revokes them.

### 5. Checks before promotion to `main`

These need a real app signed in, so they are done by hand on the `develop` test site. Each one
is an assumption the database or this guide rests on. Note the result in the session note; if
one does not hold, promotion stops and the owner decides.

- [ ] **Every token the sign-in hands an app, against Supabase directly.** Take the access token
      (the pass) and, when the app asked for the `openid` scope, the ID token. Send each as
      `Authorization: Bearer …` with the publishable key to `<project>/rest/v1/notes?select=id`
      and to `<project>/auth/v1/user`. Expected: `/rest/v1` returns no rows or an error for
      both; `/auth/v1/user` is refused, or answers no more than the account's own id and email
      and refuses a change (`PUT`). Anything else is the open item in
      [security.md](security.md#10-the-remote-connector).
- [ ] **The audience of an ordinary session.** Decode a signed-in person's own access token and
      confirm `aud` is `authenticated`. The database treats any other audience as an app and
      refuses it everywhere, so a different value here would lock people out.
- [ ] **The real format of `auth.oauth_clients.redirect_uris`.** After Claude and ChatGPT have
      each registered, read the column in the SQL editor. The database reads a JSON array of
      strings, or addresses separated by commas or white space. Then confirm
      `select public.oauth_client_tier(id), client_name, redirect_uris from auth.oauth_clients`
      gives `vendor` for both. If it gives `self_hosted`, either the format is another one or
      the app registered an address that is not on the list; both show in the same query.
- [ ] **The approval row.** After approving, confirm `auth.oauth_consents` has a row for the
      user and the client with `revoked_at` empty, and that a tool call from the app works.
      `connector_login` refuses a pass without that row.
- [ ] **Revoke, then connect again.** Revoke the agent in Settings. Confirm the app's next call
      is refused, that the row in `auth.oauth_consents` now has `revoked_at` set (or is gone),
      and that removing and re-adding the connector shows the window again and works after
      **Approve**.
- [ ] **A second authorisation through another registered address.** Register a test client with
      two redirect addresses, approve it through the first, then start a second authorisation
      through the second. Note whether Supabase Auth shows the window again or approves by
      itself. Either way the tier must not change: it is read from the registration, which has
      both addresses.

## Invitation email

The owner invites an address in **Settings**. The Edge Function `invite-email` then mails that
address one link to `<site>/join`, where the person presses **Continue**, signs in and presses
**Join**. Mail goes out through [Resend](https://resend.com). Once this works, sign-ups are
switched off, so only an invited address can ever get an account. Why it is built this way is
in [security.md](security.md#3-identity-and-tokens).

Do the six parts in this order, on the project the site uses. The web app must already be
hosted ([Hosting and the connector](#hosting-and-the-connector)), because the email links to
it. **Sign-ups are switched off last**, after the hand tests: switching them off earlier locks
out everyone who has no account yet.

**Precondition: "Confirm email" is on, and stays on** before, during and after these steps. The
database lets only a confirmed address see and accept an invitation; with the setting off,
Supabase counts an address as confirmed without proof. Check it under Authentication before
you start.

### 1. Resend: a domain and a key

1. In Resend, add the domain the invitations will come from and verify it (Resend lists the DNS
   records to add). Mail from an address on a domain that is not verified is refused.
2. Create an API key with **sending access** only, not full access. It is used in two places
   below. You may create two keys, one for each, so that either can be replaced alone.

A Resend key is a secret. Paste it only into the two dashboard fields named below: not into a
chat, a shell command, a `.env` or a commit.

### 2. Apply the migration

Apply `emailed_invitations` as in step 2 of [Steps](#steps). It makes `invite_member` return the
invitation's id and never add a member, adds `invitation_to_email`, `my_invitations` and
`accept_invitation`, removes `claim_invitations`, and takes `add_member` away from signed-in
people. Deploy the web app from the same commit: a site built before this migration calls
functions that no longer answer the same way.

### 3. Deploy the function and set its secrets

```sh
supabase functions deploy invite-email --use-api --no-verify-jwt --project-ref <project-ref>
```

It needs the Supabase CLI, signed in; it does not need Docker. JWT verification is off, as for
the other two functions: the function hands the caller's session to the database, and the
database decides whether that caller may send for that invitation.

Then set the secrets in the dashboard, under **Edge Functions → Secrets**. They are typed there
by the project owner so that no key passes through a chat or a shell history. They are not
`.env` values and nothing on an agent's machine or on Netlify needs them.

| Secret             | Value                                                                                                                |
| ------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `RESEND_API_KEY`   | The Resend key from part 1 (sending access only)                                                                     |
| `HIVE_INVITE_FROM` | The sender, for example `Hive Mind <hive@your-domain>`. The domain must be the one verified in Resend                |
| `HIVE_SITE_URL`    | The web app's address, for example `https://hive-mind-synapse.netlify.app`. No path and no slash at the end          |
| `HIVE_SECRET_KEY`  | Optional. A secret key of the project (it starts with `sb_secret_`), from Project Settings → API Keys. See the note. |

- The function also uses `HIVE_PUBLISHABLE_KEY`, which
  [Set up agent sign-in](#set-up-agent-sign-in) already stored.
- **`HIVE_SECRET_KEY` and the legacy keys.** The function needs a key that may ask Supabase Auth
  for a sign-in link. Without `HIVE_SECRET_KEY` it uses the Edge runtime's own
  `SUPABASE_SERVICE_ROLE_KEY`, which is the legacy service-role key. So the legacy API keys must
  stay enabled, and the legacy JWT secret unrevoked, until `HIVE_SECRET_KEY` is set. Either key
  bypasses every sharing rule; the function uses it for that one call and never logs it.
- `HIVE_SITE_URL` decides where the link in the email leads. During hand testing that is the
  `develop` test site; at promotion to `main` change it to the `main` site, together with the
  Site URL in part 2 of [Hosting and the connector](#2-supabase-the-dashboard-switches).
- The name `HIVE_SITE_URL` is also an optional value in the repo's `.env`, where it only tells
  `pnpm test:live` which site to check. The two are set separately.

To check by hand, with the secrets set:

| Call                                                             | Expected       |
| ---------------------------------------------------------------- | -------------- |
| `GET /functions/v1/invite-email`                                 | 405            |
| `POST /functions/v1/invite-email` with no `Authorization` header | 401, "sign in" |

When a secret is missing the function answers 503, "email is not set up", before it calls
anything, and Settings shows "Invitation saved, but the email could not be sent. Use Send
again." The 2-minute wait is 429 and the 5-email limit is 409. A failure at Supabase Auth
or at Resend is 502, "the email could not be sent"; the function's log names which, in one
fixed phrase, and never an address, a token or a key.

### 4. Supabase: mail for sign-in links

The invitation itself is sent by the function. The emails Supabase Auth sends itself are a
separate matter: the built-in mailer reaches only the project's own team, so a colleague who
chooses **Email me a link** would get nothing. That link is the way back in after an invitation
link has expired, so it must work.

1. **Authentication → Emails → SMTP settings.** Enable custom SMTP:

   | Field    | Value                                                   |
   | -------- | ------------------------------------------------------- |
   | Host     | `smtp.resend.com`                                       |
   | Port     | `465`                                                   |
   | Username | `resend`                                                |
   | Password | A Resend API key (part 1)                               |
   | Sender   | An address on the domain verified in Resend, and a name |

2. **Authentication → Sign In / Providers → Email.** Two fields, in this order:
   - [ ] **Email OTP Length**: `10`, the maximum. Do this first. With every emailed link
         Supabase also issues an email code (6 digits by default) that is valid for the same
         time, so a longer lifetime gives more time to guess it. Ten digits make that
         impractical.
   - [ ] **Email OTP Expiration**: `86400` seconds (24 hours), the maximum. It is the lifetime
         of every emailed link, the one in an invitation included.

   The dashboard's menu names change; both fields are with the email provider's settings.

3. Leave **Confirm email** on (the precondition above).

### 5. Test by hand

With **Allow new users to sign up** still on. Use the `develop` test site and addresses you can
read. Note the result in the session note.

- [ ] **A fresh address.** In Settings, invite an address that has no account. Settings answers
      "Invitation sent". The email arrives from the sender set above, names no hive and no
      person, and has one button, "Open invitation". It opens `<site>/join` with a **Continue**
      button. Continue signs the person in, shows "Signed in as" with their address and a
      sign-out link, and lists the invitation with the hive's name and who invited them.
      **Join** then offers "Choose a password" (new accounts only). Try a 9-character password
      ("Use at least 10 characters."), then save a real one: the map opens, and the person is
      listed under Members. Sign out and sign in with the address and that password. Repeat
      with another fresh address and choose **Skip for now**: the map opens the same way, and
      opening `<site>/join/password` afterwards leads straight to the map.
- [ ] **A link opened while someone else is signed in.** Signed in as the owner, open a fresh
      address's invitation link in the same browser. The page names the owner's address, says
      this browser will be signed out of it, and the button reads "Sign out and continue".
      "Stay signed in as …" leads to the map as the owner, and the link still works
      afterwards. Continuing lists the invitation under the invited address, with "You are
      now signed in with a different account."
- [ ] **An address that has an account.** The same, for an address that already has a confirmed
      account. Settings answers the same "Invitation sent", the email reads the same, and the
      person is not a member until they press Join. Join opens the map directly: no password
      is offered to an account that already exists.
- [ ] **An expired link.** Open an invitation link more than 24 hours old, or one already used,
      and press Continue. The page says the link has expired and points to "Email me a link".
      Signing in that way with the invited address leads back to `/join`, where an invitation
      that was not yet accepted is still waiting.
- [ ] **Send again, twice within two minutes.** The first sends a second email. The second
      answers "Sent a moment ago. Wait two minutes and try again." and sends nothing.

### 6. Switch sign-ups off

Only when all four tests pass:

- [ ] Under Authentication, switch **Allow new users to sign up** off. **Confirm email** stays
      on.
- [ ] **An address that was never invited.** On the sign-in page, enter such an address and
      choose **Email me a link**. No account appears under Authentication → Users, and no
      working link arrives.
- [ ] Invite one more fresh address and join with it, to confirm invitations still create
      accounts with sign-ups off.

From here on, the only way to an account is an invitation, and the owner's account from step 1
of [Steps](#steps). Dynamic client registration stays off as before; nothing here changes
[the dashboard switches](#2-supabase-the-dashboard-switches).

The limits, for when a colleague asks why nothing arrived: one email per invitation every 2
minutes, 5 emails per invitation, 20 invitations in 24 hours per hive and per inviting person
across all their hives, and an invitation lapses after 14 days. A send that fails still counts
towards the 5 and starts the 2 minutes. Revoking and inviting again does not get round the 5:
one person can cause at most 5 invitation emails to one address in 24 hours, so past that, wait
a day. Each email requested is in the audit log as `member.invitation_emailed`.

## Hive deletion

An owner marks a hive for deletion in **Settings**. For 7 days it can be read and not changed,
and the owner can cancel. Then the Edge Function `purge-hives`, called once a day by the
database's scheduler, erases it. What protects each step is in
[security.md](security.md#12-deleting-a-hive).

Do the six steps in this order, on the project the site uses. Have the migration's security
reviewed before step 1. Steps 1 to 3 need the Supabase CLI, signed in and linked to the project
(`supabase link --project-ref <project-ref>`); they do not need Docker.

1. **Apply the migration**, unchanged, and record its version:

   ```sh
   supabase db query --linked -f supabase/migrations/20261124091833_hive_deletion.sql
   ```

   Then record it in the project's migration history under the version `20261124091833`, as
   the earlier migrations are, so that a later `supabase db push` does not try to apply the
   file again. To check:

   ```sql
   select version, name from supabase_migrations.schema_migrations
    where version = '20261124091833';
   ```

   From here on an owner can mark a hive and cancel, and a marked hive is frozen. Nothing is
   erased until steps 2 and 3 are done.

2. **Deploy the function:**

   ```sh
   supabase functions deploy purge-hives --no-verify-jwt
   ```

   JWT verification is off because the scheduler has no identity; the shared secret is the
   credential. Until step 3 has stored that secret the function answers 503 to every call.

3. **Run the setup script**, once per project:

   ```sh
   scripts/setup-hive-purge.sh
   ```

   It works on the linked project; `--project-ref <project-ref>` names it explicitly. It makes
   a random secret, stores it as the function secret `HIVE_PURGE_SECRET` and in the
   database's secret store together with the function's address, enables `pg_cron` and `pg_net`
   if they are not enabled, and schedules the job `purge-hives` to call the function once a
   day. The extension DDL, the writes to the secret store and the schedule run as three
   separate statements files, so the secret never travels in a batch with DDL. It prints what
   it did by name and never the secret. Running it again makes a new secret
   and replaces the stored one and the job.

   The function also needs a key that bypasses the sharing rules: `HIVE_SECRET_KEY` if it is
   set ([Invitation email](#3-deploy-the-function-and-set-its-secrets)), else the Edge
   runtime's legacy `SUPABASE_SERVICE_ROLE_KEY`. While it depends on the legacy key, the
   legacy API keys must stay enabled.

4. **Check that the scheduled job exists.** In the SQL editor:

   ```sql
   select jobname, schedule, active from cron.job where jobname = 'purge-hives';
   ```

   Expected: one row, active.

5. **Check that a call without the secret is refused:**

   | Call                                                             | Expected |
   | ---------------------------------------------------------------- | -------- |
   | `POST /functions/v1/purge-hives` with no `x-purge-secret` header | 401      |
   | `GET /functions/v1/purge-hives`                                  | 405      |

   A 503 here means a secret is missing: step 3 did not finish. A 404 means the function is
   not deployed. Do not test with the real secret from a shell: it would stay in the shell's
   history, and the scheduler makes that call itself once a day.

6. **Redeploy the site** from the same commit. A site built before it has no Delete section,
   no banner and no "being deleted" mark; the database's rules hold either way.

A run takes only hives whose date has come, at most 20 a run, and answers with counts only.
For each hive it first stamps it and writes its row in `deleted_hives` (`begin_hive_purge`);
from then on the owner can no longer cancel. It then removes the hive's stored objects and
deletes the hive in steps of at most about 2,000 rows. A hive that fails at any step, or is too large
for one run, is left for a later run, and hives already attempted come last in the list. So
after a run, a row in `deleted_hives` with an empty `purged_at` is a hive whose erase has
begun and not finished:

```sql
select hive_id, name, requested_at, purged_at from public.deleted_hives order by requested_at;
```

Run it in the SQL editor; the API roles cannot read that table. The hosted API ends a
statement after 8 seconds. The steps are sized for that, but it has not been measured on a
large real hive, so watch the first erase of one.

## What is proven, and what is not

- `pnpm test:live` runs its checks against the hosted project: the MCP server signs in with an
  agent token through `agent-session` and calls every tool as the member, and two members'
  agents keep private notes private until a person shares them or both accept a link. It also
  calls `map_graph` as a member and as an agent, which is refused, and checks that a note an
  agent writes into a folder its member has shared is readable by the second member at once. The
  function refuses a wrong token, the database refuses an identity signed with a key it does
  not know, and Supabase Auth refuses an agent's identity.
- The checks that act as a person sign in with an email and password from `.env`
  (`HIVE_PERSON_EMAIL`, `HIVE_PERSON_PASSWORD`, and the `_2` pair for the second member) and are
  skipped, with the reason printed, when those are absent. They must be the email and password
  of the account behind `HIVE_AGENT_TOKEN` (and behind `HIVE_AGENT_TOKEN_2` for the `_2` pair):
  the person whose agent the token is. On a hive whose agent belongs to the owner, as on the dev
  project, that is the owner's own password in `.env`. Leaving the four variables out is the
  safe default; those checks then skip.
- Signing in to the web app through the browser, and the map it then draws, are checked by hand.
  No automated test signs in to the hosted project through the browser.
- With `HIVE_SITE_URL` set, `pnpm test:live` also checks the hosted site without signing in:
  `/mcp` answers 401 and names the sign-in metadata, the metadata names `/mcp` and Supabase Auth,
  and Supabase Auth answers at its discovery address. Without the variable those checks skip.
- Connecting Claude and ChatGPT through the window is checked by hand. No automated test signs
  an app in.
- Invitation email is checked by hand ([Invitation email](#5-test-by-hand)). The database rules
  behind it and the function are tested without a network (`pnpm test`); no automated test
  sends a real email or opens a real link.
- Hive deletion is not rolled out on the dev project yet ([Hive deletion](#hive-deletion)).
  The database rules behind it and the function `purge-hives` are tested without a network
  (`pnpm test`); no automated test runs the scheduler or erases a hive on a hosted project.
