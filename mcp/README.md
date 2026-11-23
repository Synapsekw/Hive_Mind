# Hive Mind MCP server

The server an agent connects to. It signs in as the member behind the agent and lets the database
decide what that agent may read and write; it checks no permissions itself.

| Way in           | Who uses it                                           | How it signs in                                   | Tools                    |
| ---------------- | ----------------------------------------------------- | ------------------------------------------------- | ------------------------ |
| Local (stdio)    | Claude Code, Codex CLI, Claude Desktop's local config | An agent token in `.env`, through `agent-session` | Seven                    |
| Remote connector | Claude and ChatGPT, web and desktop                   | A Hive Mind sign-in window, no token              | Six, no `hive_save_file` |

- **Remote connector (built).** The address is `https://<site>/mcp`, the same for everyone. The
  app opens a sign-in window; the member signs in, picks a workspace and approves. It runs as the
  Edge Function `supabase/functions/mcp`, not from this folder.
- **Six tools remotely, seven locally.** `src/tools.ts` holds the six that both offer.
  `hive_save_file` reads a file from the agent's own disk, so it exists only in the local server
  (`src/index.ts`).

Setup and the steps to connect: [`docs/hosted-db-bringup.md`](../docs/hosted-db-bringup.md).
Tool surface and the instruction template:
[`docs/agent-integration.md`](../docs/agent-integration.md). Running the local server: the root
[`README.md`](../README.md).
