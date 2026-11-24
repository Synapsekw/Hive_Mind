// The one order a note's topics are shown in, on the map and in the vault: confidence
// descending, then the kind's place in `KINDS`, then the name (plain string order), then the id.
// A topic that is not known (no kind, no name) comes after every known one at the same
// confidence. Pure.
import { KINDS, type Kind } from "./types";

/** A note's topic with what the order reads. `kind` and `name` are null for an unknown topic. */
export type Ranked = {
  id: string;
  confidence: number;
  kind: Kind | null;
  name: string | null;
};

const place = (k: Kind | null): number =>
  k === null ? KINDS.length : KINDS.indexOf(k);

const plain = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function compareRanked(a: Ranked, b: Ranked): number {
  if (a.confidence !== b.confidence) return b.confidence - a.confidence;
  const k = place(a.kind) - place(b.kind);
  if (k !== 0) return k;
  if (a.name !== b.name) {
    if (a.name === null) return 1;
    if (b.name === null) return -1;
    const n = plain(a.name, b.name);
    if (n !== 0) return n;
  }
  return plain(a.id, b.id);
}
