// Turns the `map_graph` payload into the drawing model. Pure and deterministic.
import type { Activity, MapModel, MapPayload, ModelNode } from "./types";

export const BOX: { w: 1000; h: 760 } = { w: 1000, h: 760 };

/** Hues 0..7 exist; with more than eight topics the seven largest keep theirs. */
const HUES = 8;
const DAY_MS = 86_400_000;
const CONNECTED_MS = 70 * 60_000;
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** Number of day columns in the timeline and in `Activity.days`. */
export const DAYS = 14;

/**
 * The timeline column of a moment: 13 = the UTC calendar day of `now`, 0 = 13 days earlier.
 * Anything older lands in 0, anything in the future in 13.
 */
export function dayIndex(t: number, now: number): number {
  const ago = Math.floor(now / DAY_MS) - Math.floor(t / DAY_MS);
  if (!Number.isFinite(ago)) return 0;
  return Math.max(0, Math.min(DAYS - 1, DAYS - 1 - ago));
}

function parseTime(s: string | null): number {
  if (s === null) return 0;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : 0;
}

export function buildModel(payload: MapPayload): MapModel {
  const members = payload.members.map((m) => ({
    id: m.id,
    name: m.display_name,
    isMe: m.is_me,
  }));
  const meIds = new Set(members.filter((m) => m.isMe).map((m) => m.id));
  const nameOf = new Map(members.map((m) => [m.id, m.name]));

  // Rank topics by item count, ties by name; fold the tail into "Other".
  const counts = new Map<string, number>();
  for (const n of payload.nodes)
    counts.set(n.topic, (counts.get(n.topic) ?? 0) + 1);
  const ranked = [...counts.entries()].sort((a, b) =>
    b[1] !== a[1] ? b[1] - a[1] : a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0,
  );
  const topics: MapModel["topics"] = [];
  const topicIndex = new Map<string, number>();
  const fold = ranked.length > HUES;
  ranked.forEach(([name, count], r) => {
    if (fold && r >= HUES - 1) {
      if (topics.length < HUES)
        topics.push({ name: "Other", hue: HUES - 1, count: 0 });
      topics[HUES - 1]!.count += count;
      topicIndex.set(name, HUES - 1);
    } else {
      topicIndex.set(name, topics.length);
      topics.push({ name, hue: topics.length, count });
    }
  });

  const nodes: ModelNode[] = [];
  const add = (n: Omit<ModelNode, "i" | "nb">): number => {
    const i = nodes.length;
    nodes.push({ ...n, i, nb: [] });
    return i;
  };
  add({
    id: null,
    kind: "root",
    topic: -1,
    member: null,
    mine: false,
    locked: false,
    title: "Hive index",
    path: null,
    updatedAt: 0,
    byAgent: false,
  });
  const hubAt = topics.map((t, ti) =>
    add({
      id: null,
      kind: "hub",
      topic: ti,
      member: null,
      mine: false,
      locked: false,
      title: t.name,
      path: null,
      updatedAt: 0,
      byAgent: false,
    }),
  );
  const byId = new Map<string, number>();
  for (const n of payload.nodes) {
    const locked = n.locked;
    const i = add({
      id: n.id,
      kind: n.kind,
      topic: topicIndex.get(n.topic) ?? 0,
      member: n.member_id,
      mine: meIds.has(n.member_id),
      locked,
      title: locked
        ? n.kind === "file"
          ? "Private file"
          : "Private note"
        : (n.title ?? (n.kind === "file" ? "Untitled file" : "Untitled note")),
      path: locked ? null : n.path,
      updatedAt: parseTime(n.updated_at),
      byAgent: !locked && n.by_agent === true,
    });
    byId.set(n.id, i);
  }

  const edges: [number, number][] = [];
  const seen = new Set<number>();
  const W = payload.nodes.length + topics.length + payload.agents.length + 1;
  const link = (a: number, b: number): boolean => {
    if (a === b) return false;
    const key = Math.min(a, b) * W + Math.max(a, b);
    if (seen.has(key)) return false;
    seen.add(key);
    edges.push([a, b]);
    nodes[a]!.nb.push(b);
    nodes[b]!.nb.push(a);
    return true;
  };

  for (const h of hubAt) link(0, h);
  payload.nodes.forEach((n) => {
    const i = byId.get(n.id)!;
    const hub = hubAt[nodes[i]!.topic]!;
    if (n.kind === "file" && !n.locked && n.note_id !== null) {
      const ni = byId.get(n.note_id);
      if (
        ni !== undefined &&
        nodes[ni]!.kind === "note" &&
        !nodes[ni]!.locked
      ) {
        link(ni, i);
        return;
      }
    }
    link(hub, i);
  });

  let linkCount = 0;
  for (const l of payload.links) {
    const a = byId.get(l.from);
    const b = byId.get(l.to);
    if (a === undefined || b === undefined || a === b) continue;
    linkCount++;
    link(a, b);
  }

  // Agents: own agents connect to the hubs where they wrote (agent_id); a colleague's agent to
  // the hubs where that member has readable agent-written notes.
  const hubsByAgent = new Map<string, Set<number>>();
  const hubsByAgentMember = new Map<string, Set<number>>();
  const put = (m: Map<string, Set<number>>, k: string, v: number) => {
    let s = m.get(k);
    if (!s) m.set(k, (s = new Set()));
    s.add(v);
  };
  payload.nodes.forEach((n) => {
    const i = byId.get(n.id)!;
    const hub = hubAt[nodes[i]!.topic]!;
    if (n.locked) return;
    if (n.agent_id !== null) put(hubsByAgent, n.agent_id, hub);
    if (n.kind === "note" && n.by_agent === true)
      put(hubsByAgentMember, n.member_id, hub);
  });
  for (const a of payload.agents) {
    const mine = meIds.has(a.member_id);
    const i = add({
      id: a.id,
      kind: "agent",
      topic: -1,
      member: a.member_id,
      mine,
      locked: false,
      title:
        `${nameOf.get(a.member_id) ?? "Unknown"}, ${a.provider}` +
        (a.trust_tier === "self_hosted" ? ", self-hosted" : ""),
      path: null,
      updatedAt: parseTime(a.last_used_at),
      byAgent: false,
    });
    const hubs = mine
      ? hubsByAgent.get(a.id)
      : hubsByAgentMember.get(a.member_id);
    if (hubs) [...hubs].sort((x, y) => x - y).forEach((h) => link(i, h));
  }

  return {
    topics,
    members,
    nodes,
    edges,
    linkCount,
    truncated: payload.truncated,
  };
}

export function activity(model: MapModel, now: number): Activity {
  let today = 0;
  const perCount = new Map<string, number>();
  const dayCount = new Map<string, number>();
  for (const n of model.nodes) {
    if (n.kind !== "note" && n.kind !== "file") continue;
    const age = now - n.updatedAt;
    if (age >= 0 && age < DAY_MS) {
      today++;
      if (n.member !== null)
        perCount.set(n.member, (perCount.get(n.member) ?? 0) + 1);
    }
    if (n.byAgent && n.member !== null) {
      const ago = Math.floor(now / DAY_MS) - Math.floor(n.updatedAt / DAY_MS);
      if (ago < DAYS) {
        const key = `${dayIndex(n.updatedAt, now)}\u0000${n.member}`;
        dayCount.set(key, (dayCount.get(key) ?? 0) + 1);
      }
    }
  }
  const perMember = model.members
    .map((m) => ({ id: m.id, name: m.name, count: perCount.get(m.id) ?? 0 }))
    .sort(
      (a, b) =>
        b.count - a.count || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
    );
  const days = [...dayCount.entries()]
    .map(([k, count]) => {
      const [d, member] = k.split("\u0000") as [string, string];
      return { day: Number(d), member, count };
    })
    .sort(
      (a, b) =>
        a.day - b.day ||
        (a.member < b.member ? -1 : a.member > b.member ? 1 : 0),
    );
  return { today, perMember, days };
}

export function agentStatus(lastUsedAt: string | null, now: number): string {
  if (lastUsedAt === null) return "never used";
  const t = Date.parse(lastUsedAt);
  if (!Number.isFinite(t)) return "never used";
  if (now - t <= CONNECTED_MS) return "connected";
  const d = new Date(t);
  return `last used ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}
