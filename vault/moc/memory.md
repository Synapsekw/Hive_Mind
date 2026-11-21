---
type: moc
status: active
tags: [moc/memory]
related: ["[[00-north-star]]", "[[README]]"]
---

# Memory — Map of Content

> Self-referential map. Where does this project's memory live? Three layers:

## Layer 1: Project state (this vault)

The Obsidian vault is the **whole repo** (`.obsidian/` at the repo root), so notes here and the
project's `docs/` are all indexable.

- [[00-north-star]] — destination + current state
- [[product]] — product vision + design context
- `vault/sessions/` — session-by-session captures (what we did, why, where to pick up)
- `vault/decisions/` — decisions and gotchas, indexed in [[00-decision-index]]
- `vault/moc/*` — index notes (this file is one)
- `docs/` — PRD, specs and plans, indexed via dataview `FROM "docs"`

## Layer 2: Subagent memory (per-agent scratch)

`.claude/agent-memory/` (repo root, if/when used) — agent-specific carry-over for repeated task types.

## Layer 3: User-level auto-memory (machine-local, persists across projects)

`~/.claude/projects/<this-repo>/memory/` — preferences, feedback, and project facts saved
automatically by Claude Code. Outside the repo.

**Coexistence:** Layer 3 is _user behaviour_; Layer 1 is _project state_. They don't overlap.

Not to be confused with the product: Hive Mind _is_ a memory system for agents. This vault is the
memory of the people and agents _building_ it.

## Gotchas

```dataview
TABLE status, file.cday as "Recorded"
FROM "vault/decisions"
WHERE contains(tags, "gotcha")
SORT file.name DESC
```

## Recent sessions

```dataview
TABLE branch, file.mtime as "Updated"
FROM "vault/sessions"
WHERE type = "session"
SORT file.name DESC
LIMIT 10
```

## Related MOCs

- [[architecture]]
- [[operations]]
