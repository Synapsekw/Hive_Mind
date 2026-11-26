# @hive-mind/sync

Keeps a Mac vault folder (Obsidian or any folder of notes and files) in one Hive Mind workspace.
Each run walks the folder, skips dot folders, videos and what `.hivesyncignore` names, fingerprints
what changed, and sends only that.

Needs Node 23.6 or newer (it runs the TypeScript directly, no build).

## Commands

```bash
node sync/src/cli.ts setup [--url U] [--publishable-key K] [--folder F]
node sync/src/cli.ts now [--confirm-deletes]
node sync/src/cli.ts --confirm-deletes
node sync/src/cli.ts status
node sync/src/cli.ts uninstall
```

- `setup` asks for the hive address, the publishable key and the vault folder (flags skip the
  questions), then asks for the sync key from Settings, Sync. The key is typed at the prompt of
  macOS `security`, never on a command line, and lives only in the Keychain (service `hive-sync`,
  account `default`). Setup checks the key by signing in, saves the config and installs a launchd
  agent that runs `now --scheduled` at login and every 15 minutes.
  Run `setup` from the main Hive Mind checkout, not a task worktree (the agent bakes in the paths
  of `node` and `cli.ts`, and a worktree is deleted when its task finishes). Run it again after a
  Node upgrade. A new key waits in the Keychain under account `pending` until the hive accepts it,
  so a failed `setup` leaves a working key in place.
- `now` runs one sync. A second run while one is going is skipped.
- `--confirm-deletes` (alone or with `now`) lets through deletions the guard held back. Without it
  a run that would remove too much removes nothing and says so in a notification.
- `status` shows the folder, whether the key is in the Keychain, the last run and the log tail.
- `uninstall` removes the launchd agent, the Keychain item and the sync's own folder. Revoke the
  key in Settings, Sync as well.

## What lives where

| What                     | Where                                                 |
| ------------------------ | ----------------------------------------------------- |
| Config (address, folder) | `~/Library/Application Support/hive-sync/config.json` |
| Last run, notices shown  | `~/Library/Application Support/hive-sync/state.json`  |
| Fingerprint cache        | `~/Library/Application Support/hive-sync/cache.json`  |
| Lock                     | `~/Library/Application Support/hive-sync/run.lock`    |
| Log                      | `~/Library/Logs/hive-sync.log`                        |
| launchd agent            | `~/Library/LaunchAgents/ai.hive-mind.sync.plist`      |
| Sync key                 | the Keychain, never a file                            |

Nothing is written into the vault. Losing the cache costs one slower run. The log has one line per
run: the time and counts, never a path or a note's text. Notifications carry only fixed phrases
and numbers.
