// Every file under the vault folder the sync takes, by its path relative to the folder: "/"
// separated and NFC, the form the app keeps (macOS may hand back either form). Symbolic links
// are not followed. A folder that cannot be read is reported, never taken as empty.
import { lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { isSkipped, type Ignore } from "./skip.ts";

export type Entry = {
  path: string;
  abs: string;
  size: number;
  mtimeMs: number;
};

export function walk(
  root: string,
  ignore: Ignore,
): { entries: Entry[]; unreadable: string[]; skipped: number } {
  const entries: Entry[] = [];
  const unreadable: string[] = [];
  let skipped = 0;
  const visit = (absDir: string, relDir: string) => {
    let names: string[];
    try {
      names = readdirSync(absDir);
    } catch {
      unreadable.push(relDir);
      return;
    }
    for (const raw of names) {
      const name = raw.normalize("NFC");
      const rel = relDir ? `${relDir}/${name}` : name;
      const abs = join(absDir, raw);
      if (isSkipped(rel, ignore)) {
        skipped++;
        continue;
      }
      let st;
      try {
        st = lstatSync(abs);
      } catch {
        unreadable.push(rel);
        continue;
      }
      if (st.isSymbolicLink()) skipped++;
      else if (st.isDirectory()) visit(abs, rel);
      else if (st.isFile())
        entries.push({ path: rel, abs, size: st.size, mtimeMs: st.mtimeMs });
    }
  };
  visit(root, "");
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { entries, unreadable, skipped };
}
