// The fingerprint of each file (size, modified time, SHA-256), kept between runs so a file
// whose size and time are unchanged is not read again; for a note, also the targets it links
// to, which decide where files live. Losing the cache costs one slower run, nothing else.
import { createHash } from "node:crypto";
import {
  createReadStream,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { parseNote } from "../../web/src/import/parse.ts";
import { wikiTargets, MAX_TARGETS } from "../../web/src/import/wikilinks.ts";
import type { Entry } from "./walk.ts";

export type Cached = {
  size: number;
  mtimeMs: number;
  sha256: string;
  targets?: string[];
};
export type Cache = { version: 1; entries: Record<string, Cached> };

export const isNote = (path: string): boolean => /\.md$/i.test(path);

export function sha256Hex(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function sha256OfFile(abs: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(abs)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

const MARKDOWN_LINK = /\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;

/** What a note links to: its wiki links and embeds, and its relative markdown links. */
export function noteTargets(raw: string, path: string): string[] {
  const note = parseNote(raw, path);
  const out = new Set(wikiTargets(note.body, note.frontmatter));
  for (const m of note.body.matchAll(MARKDOWN_LINK)) {
    let target = m[1]!;
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#")) continue;
    target = target.split("#")[0]!;
    try {
      target = decodeURIComponent(target);
    } catch {
      // Kept as written.
    }
    if (target) out.add(target);
    if (out.size >= MAX_TARGETS) break;
  }
  return [...out];
}

export async function fingerprint(e: Entry, old: Cache): Promise<Cached> {
  const was = old.entries[e.path];
  if (was && was.size === e.size && was.mtimeMs === e.mtimeMs) return was;
  if (isNote(e.path)) {
    const raw = readFileSync(e.abs);
    return {
      size: e.size,
      mtimeMs: e.mtimeMs,
      sha256: sha256Hex(raw),
      targets: noteTargets(raw.toString("utf8"), e.path),
    };
  }
  return {
    size: e.size,
    mtimeMs: e.mtimeMs,
    sha256: await sha256OfFile(e.abs),
  };
}

export function loadCache(file: string): Cache {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    if (
      parsed?.version === 1 &&
      parsed.entries &&
      typeof parsed.entries === "object"
    ) {
      return parsed as Cache;
    }
  } catch {
    // Missing or unreadable: one slower run.
  }
  return { version: 1, entries: {} };
}

export function saveCache(file: string, cache: Cache): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(cache), { mode: 0o600 });
  renameSync(tmp, file);
}
