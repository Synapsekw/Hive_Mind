# Hive Mind

Shared memory for small expert teams. Every member's AI agent (Claude, ChatGPT
or anything that speaks MCP) writes notes into that member's own space. The
platform finds where people's notes overlap and links them, but only after both
people accept. Working name; the brand is not decided.

## Status

Phase 1 is under way: the engine runs on a hosted Supabase project and the owner's Claude uses it.
**Where we are right now:** [`vault/00-north-star.md`](vault/00-north-star.md).

- Database schema, sharing rules and file storage, as Supabase migrations.
- Tests for the sharing rules, including files, that need no Docker. They pass.
- A scripted walkthrough (`pnpm demo`) of two people and their agents.
- An MCP server with seven tools (six of them also through the remote connector), proven against the live project by `pnpm test:live`.
- An Edge Function, `agent-session`, that exchanges an agent token for a one-hour identity, so
  an agent's machine holds only its own token.
- Emailed invitations: the owner invites an address, an Edge Function, `invite-email`, mails it,
  and the person joins by pressing Join.
- Deleting a hive: an owner marks it, it stays readable for 7 days, and then an Edge Function,
  `purge-hives`, called once a day by the database's scheduler, erases it.
- Importing a folder of markdown notes: in the web app's vault, or with a script for unattended
  runs.
- The web app (`web/`) has sign-in, the map, the vault, where a person reads their notes,
  decides who may read them and can delete a note of their own, and the gallery, where they view, download and delete the files
  their agents saved. The other pages are not built; `docs/ui/` holds the design
  prototypes for the map and chat.

## Start here

| If you want to...                | Open                                                                               |
| -------------------------------- | ---------------------------------------------------------------------------------- |
| Know where the project stands    | [`vault/00-north-star.md`](vault/00-north-star.md)                                 |
| Understand the product           | [`docs/prd.md`](docs/prd.md)                                                       |
| Understand the design            | [`docs/superpowers/specs/`](docs/superpowers/specs/2026-11-16-hive-mind-design.md) |
| See what to build next           | [`docs/superpowers/plans/`](docs/superpowers/plans/2026-11-21-local-end-to-end.md) |
| Know the rules for building here | [`AGENTS.md`](AGENTS.md), [`CONTRIBUTING.md`](CONTRIBUTING.md)                     |
| Find any other doc               | [`docs/README.md`](docs/README.md)                                                 |

## Run it locally

You need Node 22+ and pnpm 10. Docker and the
[Supabase CLI](https://supabase.com/docs/guides/local-development) are needed only for the full
local stack.

```sh
pnpm install
pnpm test             # sharing rules + hooks, no Docker needed
pnpm demo             # two people and their agents, step by step, no Docker needed
pnpm test:live        # the MCP server and two members against the database in .env; cleans up
pnpm db:start         # local Supabase in Docker; applies the migrations
```

`supabase status` then prints the local URL and keys. Copy `.env.example` to `.env` and fill it
in: the project URL, the publishable key (it starts with `sb_publishable_`; not the legacy anon
key) and an agent token. No JWT secret is needed any more; remove `SUPABASE_JWT_SECRET` from an
older `.env`. The four `HIVE_PERSON_*` values are optional and safest left empty: `pnpm
test:live` needs the password of the account behind the agent token, which on a hive whose
agent belongs to the owner is the owner's own, and skips its person checks without them. The
hosted dev project is `tokyttkztrkjvkaksdnh`; it holds one hive, and which migrations are applied
to it is listed in [docs/hosted-db-bringup.md](docs/hosted-db-bringup.md).

### Run the web app

Copy `web/.env.example` to `web/.env.local` and fill in the project URL and the publishable key
(dashboard → Project Settings → API). Then:

```sh
pnpm dev:web          # open http://localhost:3000 and sign in
```

The app has 17 colour themes, each in dark and light, chosen under **Appearance** at the bottom
of the left rail. The choice is kept in the `hive-look` cookie in that browser, not on the
account. All theme colours come from one generated stylesheet,
`web/src/theme/themes.generated.css`; after changing `web/src/theme/themes.json` or the theme
code, regenerate it with `pnpm --filter @hive-mind/web themes`.

The hive's name at the top of the left rail opens the list of your hives, each with your role
there and a tick on the one you are in; choose another to switch. **New hive** in the same list
starts one: enter the hive's name and your name in it (1 to 60 characters each) and choose
**Create**. You become its owner; a person can own at most 5 hives. If you are in no hive yet,
the home page offers the same form. Agents and connected apps belong to the hive they were
created in. A hive cannot be renamed or left yet. The cap, the database's own name
checks and the audit entry need the `hive_cap` migration on the database.

An owner can delete a hive under **Settings → Delete this hive**. The section shows how many
members, notes and files the hive holds; type the hive's name and choose **Delete hive**.
Nothing is erased at once. For 7 days every screen of that hive shows a banner with the date,
everyone can still read, nothing new can be saved, and the hive is marked "being deleted" in
the list of hives. An agent can still be revoked in that time. An owner can choose **Cancel
deletion**, in the banner or in Settings, and the hive is as it was. After the 7 days a daily
job erases it for good, with every member's notes and files; once that job has started on the
hive it can no longer be cancelled, and a large hive may take more than one day to erase.
There is no export and no undo. It needs the `hive_deletion` migration, the
`purge-hives` Edge Function and one run of `scripts/setup-hive-purge.sh` on the project (see
[docs/hosted-db-bringup.md](docs/hosted-db-bringup.md#hive-deletion) and
[docs/security.md](docs/security.md#12-deleting-a-hive)). Without the last two a hive can be
marked and cancelled, but is never erased.

To open the vault, choose **Vault** in the left rail, or select a note on the map and choose
**Open in vault**. It shows your workspaces as tabs, then "Shared with me" for notes colleagues
have shared with you. Choose a note or a folder and use the sharing pill to change who can read
it; nothing is saved until you choose "Save".

You can delete a note of your own: open it, choose **Delete** after the sharing control, then
confirm with **Delete** again (or **Keep** to back out). The note is gone for good, with its
history and its links; there is no trash and no undo. Files attached to it stay in the gallery.
A colleague's note has no Delete.

To bring in notes you already have, choose **Import a folder** in the vault and pick a folder
of markdown notes. The files are read in your browser, and a summary shows what was found
before anything is saved. Choose where the notes go: a new workspace, named after the folder
unless you change it, or one of your workspaces in this hive. Then choose **Import**. Progress
is shown and the import can be stopped; what was saved stays. The result lists how many notes
were created, updated, unchanged, skipped and failed. Every imported note is private, and
importing never deletes a note. Importing the same folder again updates the notes that
changed and adds the new ones. Only `.md` files are imported, each at most 1 MB and at most
2,000 in one import; for a larger folder, import its subfolders one at a time. If the tab is
closed part-way, run the import again to finish. A person can have at most 20 workspaces in a
hive; that cap and the database's own check of a workspace's name (1 to 60 characters) need
the `workspace_cap` migration on the database (see
[docs/security.md](docs/security.md#13-importing-a-folder-from-the-app)).

The gallery (**Gallery** in the left rail) shows the files you may read as cards. Images and
PDFs open in a full-window viewer; every file downloads; your own files can be deleted. A file is
shared exactly as the note it is attached to, so sharing is changed on the note, in the vault.

The inbox (**Inbox** in the left rail, with the number waiting) lists what needs your own
decision: links proposed between one of your notes and a colleague's, and notes held from a
self-hosted agent. Accepting a link lets each owner read the other's linked note once both have
accepted; a declined link cannot be accepted afterwards, and the same two notes cannot be
proposed again. It needs the `inbox` migration on the database.

An accepted link is ended in the vault: open one of the two notes, find the other under
**Linked with**, and choose **Unlink**, then **Unlink** again (or **Keep** to back out). Each
owner stops reading the other's note through that link at once, and the two notes cannot be
linked again. It needs the `link_behaviours` migration on the database.

Settings (**Settings** in the left rail) lists your agents and the hive's members. **Connect an
agent** creates one and shows its token once; copy it then, because it cannot be shown again.
**Revoke** stops an agent within the hour.

To bring a person into the hive, the owner chooses **Settings → Members → Invite a member** and
enters the person's email and a display name. The server emails that address an invitation with
one button, **Open invitation**. It opens `/join`, where the person chooses **Continue**, is
signed in, sees which hive invited them and chooses **Join**. Nobody becomes a member without
pressing Join, whether or not they already have an account. An invitation lasts 14 days; under
**Invitations** the owner can **Revoke** it or **Send again** (at most once every two minutes
and five emails per invitation; a hive, and a person across all their hives, can make 20
invitations a day). The link in the email
works once and for 24 hours; after that the person signs in with **Email me a link** using the
invited address, or the owner sends again. It needs the `emailed_invitations` migration, the
`invite-email` Edge Function with its secrets, and mail set up on the project (see
[docs/hosted-db-bringup.md](docs/hosted-db-bringup.md#invitation-email) and
[docs/security.md](docs/security.md#3-identity-and-tokens)). Without them the invitation is
saved but no email goes out.

`/dev/map`, `/dev/vault`, `/dev/gallery`, `/dev/inbox` and `/dev/settings` show the screens on sample data, without an
account; `/dev/notice` shows the failed-load notice.
`pnpm --filter @hive-mind/web test:e2e` runs the browser tests; run
`pnpm --filter @hive-mind/web exec playwright install chromium` once first. The browser tests are
run by hand; they are not part of CI.

### Create your hive and connect an agent

1. Add a user under Authentication in Supabase Studio.
2. Signed in as that user, call the two functions below. From the Studio SQL editor you can
   impersonate the user with the role switcher.

```sql
select public.create_hive('My hive', 'Your name');
select * from public.create_agent(
  (select id from public.workspaces limit 1), 'Claude', 'claude');
```

`create_agent` returns the agent token once. Put it in `.env` as `HIVE_AGENT_TOKEN`. Once the
web app runs, create further agents in **Settings** instead: the token then never appears in a
query result.

The token alone does not sign an agent in. The server sends it to the project's `agent-session`
Edge Function, which answers with an identity that lasts one hour. The project owner sets that
function up once per project with `scripts/setup-agent-signing.sh <project-ref>`, in their own
terminal; see
[docs/hosted-db-bringup.md](docs/hosted-db-bringup.md#set-up-agent-sign-in). If the server
reports that `agent-session` is missing, that step has not been done on the project in `.env`.
On the dev project it is done. The key the function signs with is as powerful as the
service-role key and lives only in the function's secrets
([docs/security.md](docs/security.md#3-identity-and-tokens)). The project's legacy JWT secret
may be revoked, and its legacy API keys disabled, only once every machine runs a build from
after 2026-11-23 and the function uses the secret `HIVE_PUBLISHABLE_KEY` that the script stores.

3. Build the server and register it with Claude Code. The server reads its settings from the
   repo's `.env`, so no secret is copied into a client config:

```sh
pnpm build
claude mcp add --scope user hive -- node --env-file=/absolute/path/to/Hive_Mind/.env /absolute/path/to/Hive_Mind/mcp/dist/index.js
claude mcp list        # hive should show as connected
```

Rebuild (`pnpm build`) after any change under `mcp/`; the client runs the built file.

4. Tell one folder to use it: put the instruction template from
   [docs/agent-integration.md](docs/agent-integration.md#5-instruction-template) into that folder's
   `CLAUDE.md` and open Claude Code there. Other folders can reach the server but will not use it
   unless asked.

### Import existing notes

The web app imports a folder from the vault (**Import a folder**, described under
[Run the web app](#run-the-web-app)). The script `scripts/import-vault.mjs` remains for
unattended runs and for choosing subfolders with `--include` and `--exclude`; both follow the
same rules.

```sh
pnpm import:vault "<folder of markdown>" <workspace> --dry-run
pnpm import:vault "<folder of markdown>" <workspace> --include Decisions --exclude Templates
```

One hive note per `.md` file, at its relative path, private, in the named workspace (created if
missing). Re-running updates only the notes whose file changed and never deletes. Other file
types wait for file storage.

The importer signs in as you, not as an agent. It asks for your email and password in the
terminal (the password is not shown and not stored) and imports into the hive you belong to;
`--dry-run` signs in too, because it reads the hive. It needs `SUPABASE_URL` and
`SUPABASE_ANON_KEY` in `.env` and no agent token. For an unattended run, set `HIVE_PERSON_EMAIL`
and `HIVE_PERSON_PASSWORD` in the environment and it does not ask.

## Working in this repo

- The main checkout stays on `develop`. Build in a task worktree: `scripts/start-task.sh <name>`,
  then `scripts/finish-task.sh` from inside it.
- End a working block with `/wrapup` in Claude Code. `/whats-next` picks the next batch, `/develop
<brief>` takes one brief to a merged feature, `/goal` reports on the current plan.
- The repo is also an Obsidian vault. Open the folder in Obsidian and enable Dataview, Templater
  and Homepage.

## How sharing works

| Who                               | Can read                                                                                                              | Can write                                                                                  |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| A member                          | Their own notes, notes shared with the group or with them, and notes on the other side of a link both owners accepted | Their own space only                                                                       |
| Their agent                       | The same                                                                                                              | Only the workspace its token is bound to; never sharing, never deletes, never moves a note |
| A self-hosted agent               | Shared notes and what it wrote itself                                                                                 | Its writes are held until the member releases them                                         |
| Another hive, or nobody signed in | Nothing                                                                                                               | Nothing                                                                                    |

A note's visibility is its own setting, else the rule of the nearest folder above it that has
one, else the member's default (private). Folder rules follow the path: a note anywhere under a
shared folder is shared, including a note an agent writes there later. That note is shared at
once, without anyone reviewing it, except a note from a self-hosted agent, which is held until
the member releases it. Agents cannot move notes or change folders, so an agent cannot share a
note by putting it somewhere else.

The audit log records these sharing changes made by a person: a note's own setting changed; a
held note released; a folder rule set, changed, removed, renamed or deleted; and a note moved by
a person when that changes who can read it. Accepting, declining and unlinking a link are
recorded too. Not yet recorded: a change to a member's default visibility. Only the hive owner can read the audit log. It records who
changed what and the before and after settings, and a folder's path; it never holds a note's
text, title or path. A note deleted by a person is recorded too, with the note's id and how many
links and attached files it had.

## Agent tools

| Tool                | What it does                                      |
| ------------------- | ------------------------------------------------- |
| `hive_overview`     | Workspace, recent notes, known topics             |
| `hive_search`       | Keyword search over everything the agent may read |
| `hive_read`         | One note in full                                  |
| `hive_write`        | Create or replace a note in the agent's workspace |
| `hive_append`       | Add a dated line to a note                        |
| `hive_propose_link` | Propose a link; a person on each side must accept |

## Not built yet

The rest of the web app (chat, an audit-log screen), file storage, entity detection, automatic link discovery, synthesis
pages, the housekeeper, semantic search, hosted sign-in.
