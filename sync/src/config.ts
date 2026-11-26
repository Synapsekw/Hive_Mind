// Where the sync keeps its own things on this Mac. The project address and the publishable key
// are not secrets; the sync key is never here (it is in the Keychain).
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const dir = join(homedir(), "Library", "Application Support", "hive-sync");
export const paths = {
  dir,
  config: join(dir, "config.json"),
  state: join(dir, "state.json"),
  cache: join(dir, "cache.json"),
  lock: join(dir, "run.lock"),
  log: join(homedir(), "Library", "Logs", "hive-sync.log"),
  agent: join(homedir(), "Library", "LaunchAgents", "ai.hive-mind.sync.plist"),
};

export type Config = { url: string; anonKey: string; folder: string };
export type State = {
  failuresInRow: number;
  /** Phrases already shown, so each is shown once until things change. */
  notified: string[];
  last?: {
    at: string;
    ok: boolean;
    added: number;
    changed: number;
    moved: number;
    deleted: number;
    tooBig: number;
    refused: number;
  };
};

const read = <T>(file: string): T | null => {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
};
const write = (file: string, value: unknown) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 2), { mode: 0o600 });
  renameSync(`${file}.tmp`, file);
};

export const loadConfig = (): Config | null => read<Config>(paths.config);
export const saveConfig = (c: Config) => write(paths.config, c);
export const loadState = (): State =>
  read<State>(paths.state) ?? { failuresInRow: 0, notified: [] };
export const saveState = (s: State) => write(paths.state, s);
