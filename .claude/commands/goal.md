# /goal — The current product goal

The current product goal is **the local end-to-end slice**:
`docs/superpowers/plans/2026-11-21-local-end-to-end.md` — get one real agent writing into a real
hive on this machine, with the owner's existing notes imported as the first workspace.

When invoked:

1. Read `docs/superpowers/plans/2026-11-21-local-end-to-end.md`.
2. Check progress against reality — for each task, look for a merged `task/*` branch, a session
   note in `vault/sessions/`, or shipped code; also check `git branch --list 'task/*'` and
   `git worktree list` for in-flight work.
3. Report a compact status board: per task — done / in-flight / not started, plus what the DAG
   says is launchable **now** (unblocked items in the current batch).
4. End with a one-line recommendation of the next parallel batch to dispatch (hand off to
   `/whats-next` or `/develop` for actual dispatch — `/goal` itself is read-only and never builds).

When the goal changes, repoint this file at the new plan document.
