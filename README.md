# Hive Mind

Shared memory for small expert teams. Every member's AI agent (Claude, ChatGPT
or anything that speaks MCP) writes notes into that member's own space. The
platform finds where people's notes overlap and links them, but only after both
people accept. Working name; the brand is not decided.

## Status

Phase 0 is done; nothing has run against a real Supabase stack yet. **Where we are right now:**
[`vault/00-north-star.md`](vault/00-north-star.md).

- Database schema and sharing rules, as Supabase migrations.
- Ten tests for the sharing rules. They pass.
- A scripted walkthrough (`pnpm demo`) of two people and their agents.
- An MCP server with six tools. It typechecks, but has **not yet been run against a live
  Supabase stack**. That is the first task of Phase 1.
- No web app yet. `docs/ui/` holds the design prototypes for the map and chat.

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
pnpm test:live        # the MCP server against the database in .env; cleans up after itself
pnpm db:start         # local Supabase in Docker; applies the migrations
```

`supabase status` then prints the local URL and keys. Copy `.env.example` to `.env` and fill it
in. The hosted dev project is `tokyttkztrkjvkaksdnh`; both migrations are applied to it and it holds
one hive (see [docs/hosted-db-bringup.md](docs/hosted-db-bringup.md)).

### Create your hive and connect an agent

1. Add a user under Authentication in Supabase Studio.
2. Signed in as that user, call the two functions below. From the Studio SQL editor you can
   impersonate the user with the role switcher.

```sql
select public.create_hive('My hive', 'Your name');
select * from public.create_agent(
  (select id from public.workspaces limit 1), 'Claude', 'claude');
```

`create_agent` returns the agent token once. Put it in `.env` as `HIVE_AGENT_TOKEN`.

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

| Who                               | Can read                                                                                                              | Can write                                                              |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| A member                          | Their own notes, notes shared with the group or with them, and notes on the other side of a link both owners accepted | Their own space only                                                   |
| Their agent                       | The same                                                                                                              | Only the workspace its token is bound to; never sharing, never deletes |
| A self-hosted agent               | Shared notes and what it wrote itself                                                                                 | Its writes are held until the member releases them                     |
| Another hive, or nobody signed in | Nothing                                                                                                               | Nothing                                                                |

A note's visibility is its own setting, else its folder's, else the member's
default (private).

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

Web app, file storage, entity detection, automatic link discovery, synthesis
pages, the housekeeper, semantic search, hosted sign-in. Agent sign-in currently
relies on the project's JWT secret, which fits the local stack and will be
revisited before hosting.
