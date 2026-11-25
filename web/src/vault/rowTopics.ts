// The topic chips a note's row shows: the first `max` of the note's topics the hive still has,
// strongest first, and how many more there are.
import type { VaultTopic } from "./types";

/** The lookup `rowTopics` reads; build it once per list of topics, not once per row. */
export const topicsById = (topics: VaultTopic[]) =>
  new Map(topics.map((t) => [t.id, t]));

export function rowTopics(
  ids: string[],
  topics: VaultTopic[] | Map<string, VaultTopic>,
  max = 2,
) {
  const byId = Array.isArray(topics) ? topicsById(topics) : topics;
  const known = ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
  return { shown: known.slice(0, max), more: Math.max(0, known.length - max) };
}
