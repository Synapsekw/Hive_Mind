// The Mac's own parts: the Keychain item that holds the key, the launchd agent that runs the
// sync, a notification, and the lock that keeps two runs apart. The key never goes on a
// command line: `security` asks for it itself.
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
  closeSync,
} from "node:fs";
import { dirname } from "node:path";
import { paths } from "./config.ts";

export const LABEL = "ai.hive-mind.sync";
const SERVICE = "hive-sync";
const ACCOUNT = "default";

const xml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function plist(o: { node: string; cli: string; log: string }): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(o.node)}</string>
    <string>${xml(o.cli)}</string>
    <string>now</string>
    <string>--scheduled</string>
  </array>
  <key>StartInterval</key>
  <integer>900</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>${xml(o.log)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(o.log)}</string>
</dict>
</plist>
`;
}

const uid = () => String(process.getuid?.() ?? "");

export function installAgent(text: string): void {
  mkdirSync(dirname(paths.agent), { recursive: true });
  writeFileSync(paths.agent, text);
  spawnSync("launchctl", ["bootout", `gui/${uid()}/${LABEL}`], {
    stdio: "ignore",
  });
  execFileSync("launchctl", ["bootstrap", `gui/${uid()}`, paths.agent]);
}

export function removeAgent(): void {
  spawnSync("launchctl", ["bootout", `gui/${uid()}/${LABEL}`], {
    stdio: "ignore",
  });
  try {
    unlinkSync(paths.agent);
  } catch {
    // Not there.
  }
}

export function keychainRead(): string | null {
  try {
    const key = execFileSync(
      "security",
      ["find-generic-password", "-s", SERVICE, "-a", ACCOUNT, "-w"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    ).trim();
    return /^hsync_[0-9a-f]{64}$/.test(key) ? key : null;
  } catch {
    return null;
  }
}

/** Asks for the key on the terminal (security's own prompt) and stores it. */
export function keychainStore(): boolean {
  const r = spawnSync(
    "security",
    ["add-generic-password", "-U", "-s", SERVICE, "-a", ACCOUNT, "-w"],
    {
      stdio: "inherit",
    },
  );
  return r.status === 0;
}

export function keychainDelete(): void {
  spawnSync(
    "security",
    ["delete-generic-password", "-s", SERVICE, "-a", ACCOUNT],
    { stdio: "ignore" },
  );
}

/** The only words a notification may carry: fixed phrases with numbers, never a path. */
export type Phrase =
  | "Your sync key was refused. Run hive-sync setup."
  | "Your vault folder is missing. Nothing was synced."
  | "Hive sync has failed 3 times in a row. See the log."
  | `Hive sync held back ${number} deletions. Run hive-sync --confirm-deletes to let them through.`;

export function notify(phrase: Phrase): void {
  spawnSync(
    "osascript",
    ["-e", `display notification "${phrase}" with title "Hive sync"`],
    {
      stdio: "ignore",
    },
  );
}

/** The lock, or null while another run holds it. A lock whose process is gone is taken over. */
export function acquireLock(file: string): (() => void) | null {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      mkdirSync(dirname(file), { recursive: true });
      const fd = openSync(file, "wx");
      writeFileSync(fd, String(process.pid));
      closeSync(fd);
      return () => {
        try {
          unlinkSync(file);
        } catch {
          // Already gone.
        }
      };
    } catch {
      let pid = 0;
      try {
        pid = Number(readFileSync(file, "utf8"));
      } catch {
        continue; // it vanished between the two calls; try again
      }
      let alive = false;
      try {
        if (pid > 0 && pid !== process.pid) {
          process.kill(pid, 0);
          alive = true;
        }
      } catch {
        alive = false;
      }
      if (alive || pid === process.pid) return null;
      try {
        unlinkSync(file);
      } catch {
        // Someone else took it over first.
      }
    }
  }
  return null;
}
