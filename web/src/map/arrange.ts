// The groups the Rings view is drawn in, for one arrangement. Pure and deterministic.
import { KINDS, KIND_NAMES, type Kind } from "../topics/types";
import type { MapPayload } from "./types";

export type Arrange = "folder" | "category" | "topic" | "links" | "time";
export const ARRANGES: [Arrange, string][] = [
  ["folder", "Folder"],
  ["category", "Category"],
  ["topic", "Topic"],
  ["links", "Links"],
  ["time", "Time"],
];
/** The filter bar's label for the groups of an arrangement. */
export const GROUP_HEADING: Record<Arrange, string> = {
  folder: "Folders",
  links: "Clusters",
  time: "Months",
  category: "Categories",
  topic: "Topics",
};
export type Grouping = {
  names: string[]; // group names in drawing order
  of: number[]; // group index per payload node, same order as payload.nodes
};

const DAY_MS = 86_400_000;
const HUB_DEGREE = 25;
const PASSES = 12;
const MIN_CLUSTER = 3;
const NAME_MAX = 28;
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

type Input = Pick<MapPayload, "nodes" | "links" | "topics">;

/** Raw group key per node plus the order the keys are drawn in, before the cap. */
type Raw = { key: string[]; order: string[] };

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function bySize(key: string[]): string[] {
  const n = new Map<string, number>();
  for (const k of key) n.set(k, (n.get(k) ?? 0) + 1);
  return [...n.entries()]
    .sort((a, b) => (b[1] !== a[1] ? b[1] - a[1] : cmp(a[0], b[0])))
    .map(([k]) => k);
}

function folder(p: Input): Raw {
  const key = p.nodes.map((n) => n.topic);
  return { key, order: bySize(key) };
}

const NO_TOPIC = "No topic";

type Strong = NonNullable<MapPayload["topics"]>[number];

/** Each node's strongest topic: the first of its ids the payload lists, else null. */
function strongest(p: Input): (Strong | null)[] {
  const byId = new Map<string, Strong>();
  for (const t of p.topics ?? []) byId.set(t.id, t);
  return p.nodes.map((n) => {
    for (const id of n.topics ?? []) {
      const t = byId.get(id);
      if (t) return t;
    }
    return null;
  });
}

/** One group per kind in kind order, then No topic. Never folded: nine groups at most. */
function category(p: Input): Grouping {
  const top = strongest(p);
  const used = new Set<Kind>();
  for (const t of top) if (t) used.add(t.kind);
  const names: string[] = [];
  const at = new Map<Kind | null, number>();
  for (const k of KINDS) {
    if (!used.has(k)) continue;
    at.set(k, names.length);
    names.push(KIND_NAMES[k]);
  }
  if (top.some((t) => t === null)) {
    at.set(null, names.length);
    names.push(NO_TOPIC);
  }
  return { names, of: top.map((t) => at.get(t ? t.kind : null)!) };
}

function topic(p: Input): Raw {
  const top = strongest(p);
  // A name held by two kinds that both appear carries its kind name.
  const kinds = new Map<string, Set<Kind>>();
  for (const t of top) {
    if (!t) continue;
    const set = kinds.get(t.name);
    if (set) set.add(t.kind);
    else kinds.set(t.name, new Set([t.kind]));
  }
  const key = top.map((t) =>
    !t
      ? NO_TOPIC
      : kinds.get(t.name)!.size > 1
        ? `${t.name} (${KIND_NAMES[t.kind]})`
        : t.name,
  );
  return { key, order: bySize(key) };
}

const RECENT = "Last 2 weeks";
const EARLIER = "Earlier";

/** When an item was written; its last change when the payload has no usable created date. */
function written(n: Input["nodes"][number]): number {
  const t =
    typeof n.created_at === "string" ? Date.parse(n.created_at) : Number.NaN;
  return Number.isNaN(t) ? Date.parse(n.updated_at) : t;
}

function time(p: Input, now: number): Raw {
  // Month rank is year * 12 + month, so a bigger rank is newer.
  const rank = new Map<string, number>();
  const stamp = p.nodes.map(written);
  const key = p.nodes.map((_, i) => {
    const t = stamp[i]!;
    if (Number.isNaN(t)) return "";
    if (now - t <= 14 * DAY_MS) return RECENT;
    const d = new Date(t);
    const name = `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
    rank.set(name, d.getUTCFullYear() * 12 + d.getUTCMonth());
    return name;
  });
  const months = [...rank.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name);
  const oldest = months[months.length - 1] ?? EARLIER;
  const fixed = key.map((k) => (k === "" ? oldest : k));
  const order: string[] = [];
  if (fixed.includes(RECENT)) order.push(RECENT);
  order.push(...months);
  if (fixed.includes(EARLIER)) order.push(EARLIER);
  return { key: fixed, order };
}

const HUBS = "Hub notes";
const SMALL = "Small clusters";
/** Notes whose every link goes to a hub: linked, but in no cluster. */
const HUB_LEAVES = "Linked to hubs";
const UNLINKED = "Unlinked";

function links(p: Input): Raw {
  const n = p.nodes.length;
  const at = new Map<string, number>();
  p.nodes.forEach((node, i) => at.set(node.id, i));

  // Each linked pair counts once per end, however many rows link it and in which direction;
  // links to unknown ids and self links are skipped.
  const adj: number[][] = p.nodes.map(() => []);
  const seen = new Set<number>();
  for (const l of p.links) {
    const a = at.get(l.from);
    const b = at.get(l.to);
    if (a === undefined || b === undefined || a === b) continue;
    const pair = Math.min(a, b) * n + Math.max(a, b);
    if (seen.has(pair)) continue;
    seen.add(pair);
    adj[a]!.push(b);
    adj[b]!.push(a);
  }
  for (const list of adj) list.sort((x, y) => x - y);
  const degree = adj.map((list) => list.length);
  const hub = degree.map((d) => d > HUB_DEGREE);
  const soft = adj.map((list) => list.filter((j) => !hub[j]));

  // Label propagation over non-hub neighbours, in index order, updating in place.
  const label = Array.from({ length: n }, (_, i) => i);
  for (let pass = 0; pass < PASSES; pass++) {
    for (let i = 0; i < n; i++) {
      if (hub[i]) continue;
      const near = soft[i]!;
      if (near.length === 0) continue;
      const votes = new Map<number, number>();
      for (const j of near) {
        const l = label[j]!;
        votes.set(l, (votes.get(l) ?? 0) + 1);
      }
      let best = label[i]!;
      let bestVotes = 0;
      for (const [l, v] of votes) {
        if (v > bestVotes || (v === bestVotes && l < best)) {
          best = l;
          bestVotes = v;
        }
      }
      label[i] = best;
    }
  }

  // Members of each cluster, in index order.
  const clusters = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    if (hub[i] || soft[i]!.length === 0) continue;
    const list = clusters.get(label[i]!);
    if (list) list.push(i);
    else clusters.set(label[i]!, [i]);
  }

  const key: string[] = new Array<string>(n).fill(UNLINKED);
  for (let i = 0; i < n; i++) {
    if (hub[i]) key[i] = HUBS;
    else if (degree[i]! > 0 && soft[i]!.length === 0) key[i] = HUB_LEAVES;
  }

  // Real clusters get names in size order, then member index.
  const real = [...clusters.values()]
    .filter((m) => m.length >= MIN_CLUSTER)
    .sort((a, b) => b.length - a.length || a[0]! - b[0]!);
  for (const m of clusters.values()) {
    if (m.length < MIN_CLUSTER) for (const i of m) key[i] = SMALL;
  }

  const used = new Set<string>([HUBS, SMALL, HUB_LEAVES, UNLINKED]);
  let unnamed = 0;
  for (const m of real) {
    let best = -1;
    for (const i of m) {
      const node = p.nodes[i]!;
      // A locked member, or one whose title is blank, has nothing to name the cluster by.
      if (node.locked || node.title === null || node.title.trim() === "")
        continue;
      if (best === -1 || degree[i]! > degree[best]!) best = i;
    }
    let name =
      best === -1
        ? `Cluster ${++unnamed}`
        : p.nodes[best]!.title!.slice(0, NAME_MAX);
    if (used.has(name)) {
      let k = 2;
      while (used.has(`${name} (${k})`)) k++;
      name = `${name} (${k})`;
    }
    used.add(name);
    for (const i of m) key[i] = name;
  }

  return { key, order: bySize(key) };
}

function cap(raw: Raw, max: number, fold: string, foldAlt: string): Grouping {
  const keep = Math.max(1, max);
  const at = new Map<string, number>();
  if (raw.order.length <= keep) {
    raw.order.forEach((k, i) => at.set(k, i));
    return { names: raw.order, of: raw.key.map((k) => at.get(k)!) };
  }
  const kept = raw.order.slice(0, keep - 1);
  const names = [...kept, kept.includes(fold) ? foldAlt : fold];
  kept.forEach((k, i) => at.set(k, i));
  return { names, of: raw.key.map((k) => at.get(k) ?? keep - 1) };
}

export function grouping(
  p: Input,
  arrange: Arrange,
  now: number,
  max = 12,
): Grouping {
  if (p.nodes.length === 0) return { names: [], of: [] };
  if (arrange === "category") return category(p);
  if (arrange === "topic")
    return cap(topic(p), max, "Other topics", "More topics");
  if (arrange === "time") return cap(time(p, now), max, EARLIER, EARLIER);
  if (arrange === "links") return cap(links(p), max, "Other", "Other clusters");
  return cap(folder(p), max, "Other", "Other topics");
}
