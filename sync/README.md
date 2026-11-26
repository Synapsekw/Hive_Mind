# @hive-mind/sync

Keeps a Mac vault folder (Obsidian or any folder of notes and files) in one Hive Mind workspace.
Each run walks the folder, skips dot folders, videos and what `.hivesyncignore` names, fingerprints
what changed, and sends only that.

Needs Node 23.6 or newer (it runs the TypeScript directly, no build).

```bash
node sync/src/cli.ts setup     # choose the folder and workspace, sign in
```

Subcommands are listed by `node sync/src/cli.ts help`.

Logs, the fingerprint cache and the config live in the sync's own folder under the home
directory, never in the vault. Losing the cache costs one slower run.
