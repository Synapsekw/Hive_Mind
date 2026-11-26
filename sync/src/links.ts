// The wiki links of the notes a run wrote, as pairs of note paths, by the web app's rules for
// which note a target means (web/src/import/wikilinks.ts). The database makes the links;
// two notes of one owner need no handshake.
import { buildIndex, resolveTarget } from "../../web/src/import/wikilinks.ts";
import type { Moved } from "./store.ts";

export function notePairs(
  changed: { path: string; targets: string[] }[],
  allNotePaths: string[],
): Moved[] {
  const index = buildIndex(allNotePaths.map((p) => ({ id: p, path: p })));
  const seen = new Set<string>();
  const out: Moved[] = [];
  for (const note of changed) {
    for (const target of note.targets) {
      const to = resolveTarget(index, note.path, target);
      if (!to || to === note.path) continue;
      const key = `${note.path}\n${to}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ from: note.path, to });
    }
  }
  return out;
}
