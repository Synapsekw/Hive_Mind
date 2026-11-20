# Hive Mind

Shared memory for small expert teams. Every member's AI agent (Claude, ChatGPT
or anything that speaks MCP) writes notes into that member's own space. The
platform finds where people's notes overlap and links them, but only after both
people accept. Working name; the brand is not decided.

## Status

Local only, first slice:

- Database schema and sharing rules, as Supabase migrations.
- Ten tests for the sharing rules. They pass.
- An MCP server with six tools. It typechecks, but has **not yet been run
  against a live Supabase stack**. That is the next step.
- No web app yet. `docs/ui/` holds the design prototypes for the map and chat.

## Run it locally

You need Node 22+, Docker, and the [Supabase CLI](https://supabase.com/docs/guides/local-development).

```sh
npm install
npm test              # sharing rules, no Docker needed
npm run db:start      # local Supabase in Docker; applies the migrations
```

`supabase status` then prints the local URL and keys. Copy `.env.example` to
`.env` and fill it in.

### Create your hive and connect an agent

1. Open the local Studio (URL from `supabase status`) and add a user under
   Authentication.
2. Signed in as that user, call the two functions below. From the Studio SQL
   editor you can impersonate the user with the role switcher.

```sql
select public.create_hive('My hive', 'Your name');
select * from public.create_agent(
  (select id from public.workspaces limit 1), 'Claude', 'claude');
```

`create_agent` returns the agent token once. Put it in `.env` as
`HIVE_AGENT_TOKEN`.

3. Build the server and point your agent at it:

```sh
npm run mcp:build
```

```json
{
  "mcpServers": {
    "hive": {
      "command": "node",
      "args": ["/absolute/path/to/Hive_Mind/mcp/dist/index.js"],
      "env": {
        "SUPABASE_URL": "http://127.0.0.1:54321",
        "SUPABASE_ANON_KEY": "...",
        "SUPABASE_JWT_SECRET": "...",
        "HIVE_AGENT_TOKEN": "hive_..."
      }
    }
  }
}
```

## How sharing works

| Who | Can read | Can write |
| --- | --- | --- |
| A member | Their own notes, notes shared with the group or with them, and notes on the other side of a link both owners accepted | Their own space only |
| Their agent | The same | Only the workspace its token is bound to; never sharing, never deletes |
| A self-hosted agent | Shared notes and what it wrote itself | Its writes are held until the member releases them |
| Another hive, or nobody signed in | Nothing | Nothing |

A note's visibility is its own setting, else its folder's, else the member's
default (private).

## Agent tools

| Tool | What it does |
| --- | --- |
| `hive_overview` | Workspace, recent notes, known topics |
| `hive_search` | Keyword search over everything the agent may read |
| `hive_read` | One note in full |
| `hive_write` | Create or replace a note in the agent's workspace |
| `hive_append` | Add a dated line to a note |
| `hive_propose_link` | Propose a link; a person on each side must accept |

## Not built yet

Web app, file storage, entity detection, automatic link discovery, synthesis
pages, the housekeeper, semantic search, hosted sign-in. Agent sign-in currently
relies on the project's JWT secret, which fits the local stack and will be
revisited before hosting.
