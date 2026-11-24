// Which nodes are lit for a filter, a search and a selection. Pure; the prototype's `lit` rule.
import type { Filter, MapModel } from "./types";

/**
 * A key for a node that survives a refreshed payload: the database id for items and agents,
 * the topic name for a hub, a constant for the root. Indices shift when nodes come and go.
 */
export function nodeKey(model: MapModel, i: number | null): string | null {
  const n = i !== null ? model.nodes[i] : undefined;
  if (!n) return null;
  if (n.kind === "root") return "root";
  if (n.kind === "hub") return `hub:${model.topics[n.topic]?.name ?? ""}`;
  return n.id !== null ? `${n.kind}:${n.id}` : null;
}

/** The node a key from `nodeKey` names in this model, or null when it no longer exists. */
export function nodeIndex(model: MapModel, key: string | null): number | null {
  if (key === null) return null;
  for (const n of model.nodes) if (nodeKey(model, n.i) === key) return n.i;
  return null;
}

/** The index of the topic with this name, or null when there is none. */
export function topicIndexOf(
  model: MapModel,
  name: string | null,
): number | null {
  if (name === null) return null;
  const i = model.topics.findIndex((t) => t.name === name);
  return i >= 0 ? i : null;
}

export function lit(model: MapModel, f: Filter): boolean[] {
  const q = f.q.trim().toLowerCase();
  const sel = f.sel !== null ? (model.nodes[f.sel] ?? null) : null;
  const near = new Set<number>(sel ? sel.nb : []);
  const topicName = model.topics.map((t) => t.name.toLowerCase());
  // Group names are searched unless the filter says not to (see Filter.groupNames).
  const byGroup = f.groupNames !== false;
  // An empty list means all, so it builds no set and filters nothing.
  const topics = f.topics.length ? new Set(f.topics) : null;
  const kinds = f.kinds.length ? new Set(f.kinds) : null;
  const members = f.members.length ? new Set(f.members) : null;
  return model.nodes.map((n) => {
    let ok = true;
    if (topics) ok = topics.has(n.topic);
    if (kinds) ok = ok && kinds.has(n.kind);
    if (members) ok = ok && n.member !== null && members.has(n.member);
    // `n.title` is already the shown title ("Private note" when locked), so a locked node can
    // never match on its real one.
    if (q)
      ok =
        ok &&
        (n.title.toLowerCase().includes(q) ||
          (byGroup && n.topic >= 0 && topicName[n.topic]!.includes(q)));
    if (sel) ok = ok && (n.i === sel.i || near.has(n.i));
    if (n.kind === "root" && !sel && !q) ok = true;
    return ok;
  });
}

/** How many notes and files are lit, and how many there are. */
export function shown(
  model: MapModel,
  on: boolean[],
): { shown: number; total: number } {
  let total = 0;
  let lit = 0;
  model.nodes.forEach((n, i) => {
    if (n.kind !== "note" && n.kind !== "file") return;
    total++;
    if (on[i]) lit++;
  });
  return { shown: lit, total };
}
