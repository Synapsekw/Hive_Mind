// The topic chips a note's row shows: the first `max` of the note's topics the hive still has,
// strongest first, and how many more there are.
import type { VaultTopic } from "./types";

export function rowTopics(ids: string[], topics: VaultTopic[], max = 2) {
  const byId = new Map(topics.map((t) => [t.id, t]));
  const known = ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
  return { shown: known.slice(0, max), more: Math.max(0, known.length - max) };
}
