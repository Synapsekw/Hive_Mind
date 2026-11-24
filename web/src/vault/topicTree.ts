// The topic column for the notes of one tab: kinds, their topics and the notes under each.
// Pure. A topic id the hive's list does not have is not counted; only topics that carry a note
// of this tab are listed.
import { KIND_NAMES, KINDS, type Kind } from "../topics/types";
import type { VaultNote, VaultTopic } from "./types";

export type TopicKind = {
  kind: Kind;
  name: string;
  /** Distinct notes carrying any of its topics. */
  count: number;
  topics: { id: string; name: string; count: number }[];
};

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function topicTree(
  notes: VaultNote[],
  topics: VaultTopic[],
): { kinds: TopicKind[]; none: number } {
  const known = new Map(topics.map((t) => [t.id, t]));
  const perTopic = new Map<string, number>();
  const perKind = new Map<Kind, Set<string>>();
  let none = 0;
  for (const n of notes) {
    if (n.topics.length === 0) none += 1;
    for (const id of new Set(n.topics)) {
      const t = known.get(id);
      if (!t) continue;
      perTopic.set(id, (perTopic.get(id) ?? 0) + 1);
      const set = perKind.get(t.kind) ?? new Set<string>();
      set.add(n.id);
      perKind.set(t.kind, set);
    }
  }
  const kinds: TopicKind[] = [];
  for (const kind of KINDS) {
    const carried = perKind.get(kind);
    if (!carried) continue;
    kinds.push({
      kind,
      name: KIND_NAMES[kind],
      count: carried.size,
      topics: topics
        .filter((t) => t.kind === kind && perTopic.has(t.id))
        .map((t) => ({ id: t.id, name: t.name, count: perTopic.get(t.id)! }))
        .sort((a, b) => cmp(a.name, b.name) || cmp(a.id, b.id)),
    });
  }
  return { kinds, none };
}
