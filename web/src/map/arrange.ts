// The groups the Rings view is drawn in, for one arrangement. Pure and deterministic.
import type { MapPayload } from "./types";

export type Arrange = "folder" | "links" | "time";
export const ARRANGES: [Arrange, string][] = [
  ["folder", "Folder"],
  ["links", "Links"],
  ["time", "Time"],
];
/** The dock's heading for the groups of an arrangement. */
export const GROUP_HEADING: Record<Arrange, string> = {
  folder: "Folders",
  links: "Clusters",
  time: "Months",
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

type Input = Pick<MapPayload, "nodes" | "links">;

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

const RECENT = "Last 2 weeks";
const EARLIER = "Earlier";

function time(p: Input, now: number): Raw {
  // Month rank is year * 12 + month, so a bigger rank is newer.
  const rank = new Map<string, number>();
  const stamp = p.nodes.map((n) => Date.parse(n.updated_at));
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
const UNLINKED = "Unlinked";

function links(p: Input): Raw {
  const n = p.nodes.length;
  const at = new Map<string, number>();
  p.nodes.forEach((node, i) => at.set(node.id, i));

  // Each link counts once per end; links to unknown ids and self links are skipped.
  const adj: number[][] = p.nodes.map(() => []);
  for (const l of p.links) {
    const a = at.get(l.from);
    const b = at.get(l.to);
    if (a === undefined || b === undefined || a === b) continue;
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
  for (let i = 0; i < n; i++) if (hub[i]) key[i] = HUBS;

  // Real clusters get names in size order, then member index.
  const real = [...clusters.values()]
    .filter((m) => m.length >= MIN_CLUSTER)
    .sort((a, b) => b.length - a.length || a[0]! - b[0]!);
  for (const m of clusters.values()) {
    if (m.length < MIN_CLUSTER) for (const i of m) key[i] = SMALL;
  }

  const used = new Set<string>([HUBS, SMALL, UNLINKED]);
  let unnamed = 0;
  for (const m of real) {
    let best = -1;
    for (const i of m) {
      const node = p.nodes[i]!;
      if (node.locked || node.title === null) continue;
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
  if (arrange === "time") return cap(time(p, now), max, EARLIER, EARLIER);
  if (arrange === "links") return cap(links(p), max, "Other", "Other clusters");
  return cap(folder(p), max, "Other", "Other topics");
}
