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
- An MCP server with seven tools, proven against the live project by `pnpm test:live`.
- An importer for a folder of markdown notes.
- The web app (`web/`) has sign-in, the map, the vault, where a person reads their notes and
  decides who may read them, and the gallery, where they view, download and delete the files
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
in. The hosted dev project is `tokyttkztrkjvkaksdnh`; all seven migrations are applied to it and it holds
one hive (see [docs/hosted-db-bringup.md](docs/hosted-db-bringup.md)).

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

To open the vault, choose **Vault** in the left rail, or select a note on the map and choose
**Open in vault**. It shows your workspaces as tabs, then "Shared with me" for notes colleagues
have shared with you. Choose a note or a folder and use the sharing pill to change who can read
it; nothing is saved until you choose "Save".

The gallery (**Gallery** in the left rail) shows the files you may read as cards. Images and
PDFs open in a full-window viewer; every file downloads; your own files can be deleted. A file is
shared exactly as the note it is attached to, so sharing is changed on the note, in the vault.

The inbox (**Inbox** in the left rail, with the number waiting) lists what needs your own
decision: links proposed between one of your notes and a colleague's, and notes held from a
self-hosted agent. Accepting a link lets each owner read the other's linked note once both have
accepted; a declined link cannot be accepted afterwards. It needs the `inbox` migration on the database.

Settings (**Settings** in the left rail) lists your agents and the hive's members. **Connect an
agent** creates one and shows its token once; copy it then, because it cannot be shown again.
**Revoke** stops an agent within the hour.

To bring a person into the hive, the owner chooses **Settings → Members → Invite a member** and
enters the person's email and a display name. A person who already has an account with a
confirmed email is added at once. Anyone else gets an invitation and joins the first time they
sign in with that email: they open the sign-in page, enter the email and choose **Email me a
link**. The app sends no email, so the owner passes the sign-in address on themselves; Settings
shows it with a **Copy address** button. An invitation lasts 14 days and the owner can revoke it
under **Invitations**. It needs the `invitations` migration on the database and two project
settings (see [docs/security.md](docs/security.md#3-identity-and-tokens)).

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

```sh
pnpm import:vault "<folder of markdown>" <workspace> --dry-run
pnpm import:vault "<folder of markdown>" <workspace> --include Decisions --exclude Templates
```

One hive note per `.md` file, at its relative path, private, in the named workspace (created if
missing). Re-running updates only the notes whose file changed and never deletes. It signs in as
the person behind the agent token in `.env`. Other file types wait for file storage.

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
a person when that changes who can read it. Not yet recorded: a change to a member's default
visibility, and accepting a link. Only the hive owner can read the audit log. It records who
changed what and the before and after settings, and a folder's path; it never holds a note's
text, title or path.

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

The rest of the web app (chat, settings, an audit-log screen), file storage, entity detection, automatic link discovery, synthesis
pages, the housekeeper, semantic search, hosted sign-in. Agent sign-in currently
relies on the project's JWT secret, which fits the local stack and will be
revisited before hosting.
