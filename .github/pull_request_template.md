<!-- Title must follow Conventional Commits, e.g. `feat(mcp): add file upload tool`. -->

## Summary

<!-- What does this PR do and why? Link the phase/spec or plan. -->

## Type of change

- [ ] feat — new feature
- [ ] fix — bug fix
- [ ] refactor / perf / style
- [ ] docs / chore / ci
- [ ] test

## How it was tested

<!-- Commands run + what you verified. -->

- [ ] `pnpm typecheck`
- [ ] `pnpm lint`
- [ ] `pnpm test`
- [ ] `pnpm build`
- [ ] Manual (describe)

## Database / sharing rules (if applicable)

- [ ] Schema change is a new versioned migration in `supabase/migrations/` (minted by `scripts/new-migration.sh`)
- [ ] A change to who can see what has a test in `tests/sharing-rules.test.mjs`
- [ ] No tool lets an agent set sharing, accept a link or delete a note

## Checklist

- [ ] Conventional Commit messages
- [ ] No secrets committed (`.env` stays local)
- [ ] Docs / dev-memory `vault/` updated where relevant
