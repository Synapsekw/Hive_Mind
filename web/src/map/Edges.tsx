// What sits under the dots: the guide rings and timeline axis, the edges, the timeline's
// agent-write ticks and the core swarm. All of it is decoration for sighted users
// (aria-hidden); the same facts are on the dots and in the detail rail.
import { DAYS } from "./graph";
import type { Activity, MapModel, View } from "./types";
import s from "./map.module.css";

const CX = 500;
const CY = 380;
const X0 = 250;
const CW = 51;
const DAY_MS = 86_400_000;
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

const f = (v: number) => v.toFixed(1);
const pct = (v: number) => String(Math.round(v * 100) / 100);
const ring = (r: number) =>
  `M${CX - r} ${CY}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;

export function edgePaths(
  model: MapModel,
  pos: [number, number][],
  on: boolean[],
  sel: number | null,
  view: View,
  filtered: boolean,
): { base: string; hi: string } {
  const isTime = view === "timeline";
  let base = "";
  let hi = "";
  if (view === "orbit") return { base, hi };
  for (const [u, v] of model.edges) {
    const a = pos[u];
    const b = pos[v];
    if (!a || !b) continue;
    const seg = `M${f(a[0])} ${f(a[1])}L${f(b[0])} ${f(b[1])}`;
    const lit =
      sel !== null
        ? u === sel || v === sel
        : !isTime && filtered && on[u] && on[v];
    if (lit) hi += seg;
    else if (!isTime) base += seg;
  }
  return { base, hi };
}

/** Deterministic points for the core: one per item written in the last 24 hours. */
function swarm(count: number): string {
  let seed = 7;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  let d = "";
  for (let i = 0; i < Math.min(count, 200); i++) {
    const r = 4 + 46 * rnd() * rnd();
    const a = rnd() * Math.PI * 2;
    d += `M${f(CX + r * Math.cos(a))} ${f(CY + r * Math.sin(a))}h.01`;
  }
  return d;
}

/** Agent writes per day: one row per member, level with that member's first agent. */
function ticks(
  model: MapModel,
  pos: [number, number][],
  act: Activity,
): string {
  const rowY = new Map<string, number>();
  let next = 0;
  for (const n of model.nodes) {
    if (n.kind !== "agent" || n.member === null) continue;
    const y = pos[n.i]?.[1] ?? 0;
    if (!rowY.has(n.member)) rowY.set(n.member, y);
    next = Math.max(next, y);
  }
  let d = "";
  for (const { day, member, count } of act.days) {
    let y = rowY.get(member);
    if (y === undefined) {
      next = Math.min(300, next + 40);
      y = next;
      rowY.set(member, y);
    }
    // Up to four dots sit apart; a busier day closes them into a bar.
    const n = Math.min(count, 41);
    const step = n > 1 ? Math.min(10, 36 / (n - 1)) : 0;
    for (let k = 0; k < n; k++)
      d += `M${f(X0 + day * CW + 8 + k * step)} ${y}h.01`;
  }
  return d;
}

export function Backdrop({
  model,
  pos,
  view,
  act,
  edges,
}: {
  model: MapModel;
  pos: [number, number][];
  view: View;
  act: Activity;
  edges: { base: string; hi: string; baseOpacity: number };
}) {
  const isTime = view === "timeline";
  const guides =
    view === "rings"
      ? ring(143) + ring(228) + ring(272)
      : isTime
        ? `M${X0} 392H964`
        : "";
  return (
    <svg aria-hidden="true" viewBox="0 0 1000 760" className={s.svg}>
      {guides && (
        <path d={guides} fill="none" stroke="#1b2433" strokeWidth="1" />
      )}
      <g key={view} className={s.edges}>
        <path
          d={edges.base}
          fill="none"
          stroke="#5a6c8e"
          strokeWidth="0.6"
          strokeOpacity={edges.baseOpacity}
        />
        <path
          d={edges.hi}
          fill="none"
          stroke="#e6ebf5"
          strokeWidth="1"
          strokeOpacity=".8"
        />
      </g>
      {isTime && (
        <path
          d={ticks(model, pos, act)}
          fill="none"
          stroke="#5f6e8a"
          strokeWidth="4"
          strokeLinecap="round"
        />
      )}
      {!isTime && act.today > 0 && (
        <path
          className={s.core}
          d={swarm(act.today)}
          fill="none"
          stroke="#7fd4f5"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}

function dayLabel(c: number, now: number): string {
  if (c === DAYS - 1) return "Today";
  const d = new Date((Math.floor(now / DAY_MS) - (DAYS - 1 - c)) * DAY_MS);
  const day = d.getUTCDate();
  return c === 0 || day === 1 ? `${day} ${MONTHS[d.getUTCMonth()]}` : `${day}`;
}

/** Text on the guides: ring names in Rings, axis names and dates in Timeline. */
export function GuideLabels({ view, now }: { view: View; now: number }) {
  const labels: { name: string; x: number; y: number; left?: boolean }[] = [];
  if (view === "rings") {
    for (const [name, r] of [
      ["Topics", 120],
      ["Notes", 187],
      ["Files", 250],
      ["Agents", 322],
    ] as const)
      labels.push({ name, x: CX, y: CY - r });
  } else if (view === "timeline") {
    labels.push({ name: "Agent writes by day", x: 22, y: 30, left: true });
    labels.push({ name: "Topics", x: 46, y: 330, left: true });
    labels.push({
      name: "Notes and files by last change",
      x: 22,
      y: 436,
      left: true,
    });
    for (let c = 0; c < DAYS; c++)
      labels.push({ name: dayLabel(c, now), x: X0 + c * CW + 22, y: 410 });
  }
  return (
    <>
      {labels.map((l) => (
        <span
          key={`${l.name}-${l.x}`}
          aria-hidden="true"
          className={s.guideLabel}
          data-left={l.left || undefined}
          style={{ left: `${pct(l.x / 10)}%`, top: `${pct(l.y / 7.6)}%` }}
        >
          {l.name}
        </span>
      ))}
    </>
  );
}
