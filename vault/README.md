---
type: moc
status: active
tags: [vault/meta]
---

# Hive Mind vault — How this works

The Obsidian vault is the **whole Hive Mind repo** (`.obsidian/` lives at the repo root); this
`vault/` folder holds the **development-memory** layer on top of the codebase: where we are, why we
made each call, and what happened session by session. The codebase tells you _what_ the code is;
this folder tells you _why_ it got that way. Same model as the Monolith vault.

## Entry point

→ **[[00-north-star]]** — the canonical "where are we, where are we going, why" doc. Open this first.

## Layout

- `vault/00-north-star.md` — the destination + current state (start here)
- `vault/product.md` — product vision, users, design principles
- `vault/moc/` — Maps of Content (thin indexes: architecture, roadmap, specs, operations, memory)
- `vault/decisions/` — decisions and gotchas (dated), indexed in [[00-decision-index]]
- `vault/sessions/` — what each working session did (the real "what we did" log)
- `vault/templates/` — note templates (Templater)
- `vault/_attachments/` — pasted images/files
- `docs/` — PRD, specs and plans (indexed via dataview `FROM "docs"`)

## Maintenance rules

### 1. North-star bump rule

When a phase closes or the current state shifts, update the relevant section in `00-north-star.md`
and bump `last-updated` in its frontmatter. `/wrapup` does this.

### 2. Capture a session at the end of each working block

Run `/wrapup`. It writes `vault/sessions/YYYY-MM-DD-HHmm-short-slug.md`: what changed, why, how to
test, open threads, where to pick up next — and commits `vault/` only.

### 3. Record gotchas as decisions

When you hit a non-obvious trap (especially Supabase / RLS / MCP surprises), write a short note in
`vault/decisions/` from `vault/templates/decision.md`. Tag it `gotcha`, take the next free number
from [[00-decision-index]] and add a row there. This is how we stop re-learning the same lesson.

### 4. Frontmatter-or-die

Every note starts with a YAML frontmatter block at line 1 with at least a `type`:
`session | adr | moc | north-star | product-context | prd | spec | plan | design | report`.

## Required Obsidian community plugins

The live `dataview` / `dataviewjs` blocks and the `<% tp %>` template syntax need community plugins
(Settings → Community plugins): **Dataview**, **Templater** and **Homepage** (opens the north-star
on start). Without them the queries render as plain code blocks — everything else still works.

## Related

- Auto-memory under `~/.claude/projects/<this-repo>/memory/` — user-level preferences saved by
  Claude Code (a different layer; coexists). See [[memory]].
