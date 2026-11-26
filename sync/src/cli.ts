#!/usr/bin/env node
// hive-sync: keeps one Hive workspace equal to one vault folder on this Mac.
//
//   node sync/src/cli.ts setup [--url U] [--publishable-key K] [--folder F]
//   node sync/src/cli.ts now [--confirm-deletes]
//   node sync/src/cli.ts --confirm-deletes
//   node sync/src/cli.ts status
//   node sync/src/cli.ts uninstall
//
// The log gets one line per run: the time and the counts, never a path or a note's text.
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import {
  loadConfig,
  loadState,
  paths,
  saveConfig,
  saveState,
  type Config,
} from "./config.ts";
import {
  acquireLock,
  installAgent,
  keychainDelete,
  keychainWrite,
  PENDING,
  keychainRead,
  keychainStore,
  notify,
  plist,
  removeAgent,
} from "./mac.ts";
import { restStore } from "./rest-store.ts";
import { runOnce, type Report } from "./run.ts";
import { syncSession } from "./session.ts";
import { FolderMissing, KeyRefused, Unreachable } from "./store.ts";

export type Command =
  | { cmd: "now"; confirmDeletes: boolean; scheduled: boolean }
  | { cmd: "setup"; url?: string; anonKey?: string; folder?: string }
  | { cmd: "status" }
  | { cmd: "uninstall" }
  | { cmd: "help" };

export function parseArgs(argv: string[]): Command {
  const flag = (name: string) => argv.includes(name);
  const value = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
  };
  const [first] = argv;
  if (first === "now" || first === "--confirm-deletes") {
    return {
      cmd: "now",
      confirmDeletes: flag("--confirm-deletes"),
      scheduled: flag("--scheduled"),
    };
  }
  if (first === "setup") {
    const out: Command = { cmd: "setup" };
    const url = value("--url");
    const anonKey = value("--publishable-key");
    const folder = value("--folder");
    if (url) out.url = url;
    if (anonKey) out.anonKey = anonKey;
    if (folder) out.folder = folder;
    return out;
  }
  if (first === "status") return { cmd: "status" };
  if (first === "uninstall") return { cmd: "uninstall" };
  return { cmd: "help" };
}

const log = (line: string) => {
  mkdirSync(dirname(paths.log), { recursive: true });
  appendFileSync(paths.log, `${new Date().toISOString()} ${line}\n`);
};

/** What `now` touches outside itself; the tests swap these for in-memory ones. */
export type NowDeps = {
  loadConfig: typeof loadConfig;
  loadState: typeof loadState;
  saveState: typeof saveState;
  keychainRead: () => string | null;
  acquireLock: () => (() => void) | null;
  run: (o: {
    config: Config;
    key: string;
    confirmDeletes: boolean;
  }) => Promise<Report>;
  notify: typeof notify;
  log: (line: string) => void;
};

const realNowDeps: NowDeps = {
  loadConfig,
  loadState,
  saveState,
  keychainRead: () => keychainRead(),
  acquireLock: () => acquireLock(paths.lock),
  run: ({ config, key, confirmDeletes }) =>
    runOnce({
      root: config.folder,
      cachePath: paths.cache,
      store: restStore(config, syncSession({ ...config, key })),
      confirmDeletes,
    }),
  notify,
  log,
};

export async function now(
  confirmDeletes: boolean,
  d: NowDeps = realNowDeps,
): Promise<number> {
  const config = d.loadConfig();
  const key = d.keychainRead();
  if (!config || !key) {
    d.log("not set up: run hive-sync setup");
    return 2;
  }
  const release = d.acquireLock();
  if (!release) {
    d.log("another run is still going; this one is skipped");
    return 0;
  }
  const state = d.loadState();
  const once = (phrase: Parameters<typeof notify>[0]) => {
    if (state.notified.includes(phrase)) return;
    d.notify(phrase);
    state.notified.push(phrase);
  };
  try {
    const r = await d.run({ config, key, confirmDeletes });
    const c = r.counts;
    // A run that completes is a success. A file that keeps failing is counted and shown, but it
    // is not a reason to say the sync is down; faults that hit every file throw instead.
    d.log(
      `ok added ${c.added} changed ${c.changed} moved ${c.moved} deleted ${c.deleted} skipped ${c.skipped} too-big ${c.too_big} held-back ${r.refusedDeletes} failed ${r.failed.length} deferred ${r.deferred}`,
    );
    state.failuresInRow = 0;
    state.notified = [];
    if (r.refusedDeletes > 0) {
      d.notify(
        `Hive sync held back ${Math.trunc(Number(r.refusedDeletes))} deletions. Run hive-sync --confirm-deletes to let them through.`,
      );
    }
    state.last = {
      at: new Date().toISOString(),
      ok: true,
      added: c.added,
      changed: c.changed,
      moved: c.moved,
      deleted: c.deleted,
      tooBig: c.too_big,
      refused: r.refusedDeletes,
      failed: r.failed.length,
    };
    return 0;
  } catch (e) {
    if (e instanceof KeyRefused) {
      d.log("stopped: the sync key was refused");
      once("Your sync key was refused. Run hive-sync setup.");
    } else if (e instanceof FolderMissing) {
      d.log("stopped: the vault folder is missing or unreadable");
      once("Your vault folder is missing. Nothing was synced.");
    } else {
      state.failuresInRow++;
      // Only the hive's own errors have words fit for the log; a file-system error names a path.
      d.log(`stopped: ${e instanceof Unreachable ? e.message : "an error"}`);
      if (state.failuresInRow === 3)
        d.notify("Hive sync has failed 3 times in a row. See the log.");
    }
    if (state.last) state.last.ok = false;
    return 1;
  } finally {
    d.saveState(state);
    release();
  }
}

/** The Keychain and the sign-in that `replaceKey` leans on; the tests swap them. */
export type KeyDeps = {
  prompt: (account: string) => boolean;
  read: (account: string) => string | null;
  write: (key: string, account: string) => boolean;
  remove: (account: string) => void;
  signIn: (key: string) => Promise<void>;
};

export type KeyResult =
  "ok" | "not-stored" | "bad-format" | "refused" | "unreachable";

/**
 * Takes a pasted key into account `default` only after it has been read back, found well formed
 * and accepted by the hive. Until then it waits under `pending`, so a working key is never
 * overwritten by one that does not work. On any failure `pending` is removed and `default` is
 * as it was.
 */
export async function replaceKey(d: KeyDeps): Promise<KeyResult> {
  d.remove(PENDING);
  try {
    if (!d.prompt(PENDING)) return "not-stored";
    const key = d.read(PENDING);
    if (!key) return "bad-format";
    try {
      await d.signIn(key);
    } catch (e) {
      return e instanceof KeyRefused ? "refused" : "unreachable";
    }
    return d.write(key, "default") ? "ok" : "not-stored";
  } finally {
    d.remove(PENDING);
  }
}

const isDirectory = (p: string) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};

async function setup(c: Extract<Command, { cmd: "setup" }>): Promise<number> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = async (q: string, given?: string, fallback?: string) =>
    given ??
    ((await rl.question(`${q}${fallback ? ` [${fallback}]` : ""}: `)).trim() ||
      fallback ||
      "");
  const was = loadConfig();
  const url = await ask(
    "Hive address (https://….supabase.co)",
    c.url,
    was?.url,
  );
  const anonKey = await ask("Publishable key", c.anonKey, was?.anonKey);
  const folder = resolve(await ask("Vault folder", c.folder, was?.folder));
  rl.close();
  if (!isDirectory(folder)) {
    console.error("That is not a folder that exists.");
    return 2;
  }
  console.log(
    "Paste the sync key from Settings → Sync when asked (it is not shown).",
  );
  const result = await replaceKey({
    prompt: (account) => keychainStore(account),
    read: (account) => keychainRead(account),
    write: keychainWrite,
    remove: (account) => keychainDelete(account),
    signIn: async (key) => {
      await syncSession({ url, anonKey, key }).token();
    },
  });
  if (result !== "ok") {
    const was = keychainRead() ? " Your earlier key is still in place." : "";
    console.error(
      {
        "not-stored": "The key was not stored in the Keychain.",
        "bad-format":
          "That is not a sync key (hsync_ followed by 64 characters).",
        refused: "The hive refused that key.",
        unreachable:
          "The hive could not be reached, so the key was not checked.",
      }[result] + was,
    );
    return 2;
  }
  saveConfig({ url, anonKey, folder });
  saveState({ failuresInRow: 0, notified: [] });
  const cli = fileURLToPath(import.meta.url);
  installAgent(plist({ node: process.execPath, cli, log: paths.log }));
  console.log(
    "Hive sync is set up: it runs now, every 15 minutes, and at login.",
  );
  return 0;
}

function status(): number {
  const config = loadConfig();
  const state = loadState();
  console.log(
    config ? `Folder: ${config.folder}\nHive: ${config.url}` : "Not set up.",
  );
  console.log(`Key in Keychain: ${keychainRead() ? "yes" : "no"}`);
  if (state.last) {
    const l = state.last;
    console.log(
      `Last run: ${l.at} ${l.ok ? "ok" : "stopped"} (added ${l.added}, changed ${l.changed}, moved ${l.moved}, deleted ${l.deleted}, too big ${l.tooBig}, held back ${l.refused})`,
    );
    if (l.failed) console.log(`${l.failed} items failed on the last run`);
  }
  console.log("Runs every 15 minutes and at login.");
  if (existsSync(paths.log)) {
    const lines = readFileSync(paths.log, "utf8")
      .trimEnd()
      .split("\n")
      .slice(-5);
    console.log(`Log (${paths.log}):\n${lines.join("\n")}`);
  }
  return 0;
}

function uninstall(): number {
  removeAgent();
  keychainDelete();
  rmSync(paths.dir, { recursive: true, force: true });
  console.log(
    "Hive sync is removed from this Mac. Revoke its key in Settings → Sync.",
  );
  return 0;
}

export async function main(argv: string[]): Promise<number> {
  const c = parseArgs(argv);
  if (c.cmd === "now") return now(c.confirmDeletes);
  if (c.cmd === "setup") return setup(c);
  if (c.cmd === "status") return status();
  if (c.cmd === "uninstall") return uninstall();
  console.log(
    "Usage: hive-sync setup | now [--confirm-deletes] | --confirm-deletes | status | uninstall",
  );
  return c.cmd === "help" ? 0 : 2;
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
