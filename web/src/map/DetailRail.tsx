// The right rail: today's activity until something is selected, then what it is, who wrote
// it and what it connects to. Every title is rendered as a text node.
import Link from "next/link";
import { useEffect, useId, useState, type CSSProperties } from "react";
import type { Preview } from "./MapCanvas";
import type { Activity, MapModel, ModelNode } from "./types";
import { Shape } from "./Shape";
import { daySeries, sparkPath } from "./sparkline";
import { reducedMotion } from "./useCamera";
import s from "./map.module.css";

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

function date(t: number, now: number): string {
  const d = new Date(t);
  const base = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  return d.getUTCFullYear() === new Date(now).getUTCFullYear()
    ? base
    : `${base} ${d.getUTCFullYear()}`;
}

const COUNT_MS = 1100;

/** 0 up to `target` with a cubic ease-out; instant under reduced motion. */
function useCountUp(target: number): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (reducedMotion()) {
      setV(target);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / COUNT_MS);
      setV(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return v;
}

function Today({
  model,
  act,
  inbox,
  onPreview,
}: {
  model: MapModel;
  act: Activity;
  inbox: number;
  onPreview: (p: Preview | null) => void;
}) {
  const shown = useCountUp(act.today);
  const grad = useId();
  const series = daySeries(act);
  const total = series.reduce((a, b) => a + b, 0);
  const { line, area } = sparkPath(series, 260, 54);
  const max = Math.max(1, ...act.perMember.map((m) => m.count));
  const me = new Set(model.members.filter((m) => m.isMe).map((m) => m.id));
  return (
    <section className={s.today}>
      <div>
        <p className={s.eyebrow}>Today</p>
        {act.today === 0 ? (
          <p className={s.quiet}>Nothing written today.</p>
        ) : (
          <div className={s.bigRow}>
            <div className={s.big}>
              <span aria-hidden="true">{shown}</span>
              <span className={s.srOnly}>{act.today}</span>
            </div>
            <p className={s.bigNote}>
              notes written
              <br />
              or changed
            </p>
          </div>
        )}
      </div>
      <div>
        <svg
          data-spark=""
          className={s.spark}
          viewBox="0 0 260 54"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id={grad} x1="0" y1="0" x2="0" y2="1">
              <stop
                offset="0"
                style={{ stopColor: "var(--brand)", stopOpacity: 0.35 }}
              />
              <stop
                offset="1"
                style={{ stopColor: "var(--brand)", stopOpacity: 0 }}
              />
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#${grad})`} className={s.sparkArea} />
          <path
            d={line}
            className={s.sparkLine}
            fill="none"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <p className={s.srOnly}>
          Agent writes over the last 14 days: {total} in all, {series[13] ?? 0}{" "}
          today.
        </p>
        <p aria-hidden="true" className={s.axis}>
          <span>14 days ago</span>
          <span>agent writes</span>
          <span>today</span>
        </p>
      </div>
      <div>
        <p className={s.eyebrow}>By person</p>
        <div className={s.bars}>
          {act.perMember.map((m, i) => (
            <div
              key={m.id}
              className={s.barRow}
              onPointerEnter={() => onPreview({ member: m.id })}
              onPointerLeave={() => onPreview(null)}
            >
              <span>{m.name}</span>
              <span aria-hidden="true" className={s.track}>
                <span
                  className={s.fill}
                  data-me={me.has(m.id) || undefined}
                  style={
                    {
                      "--w": m.count / max,
                      "--i": i,
                    } as CSSProperties
                  }
                />
              </span>
              <span className={s.count}>{m.count}</span>
            </div>
          ))}
        </div>
      </div>
      {inbox > 0 && (
        <div>
          <p className={s.eyebrow}>Needs you</p>
          <Link href="/inbox" className={s.needs}>
            <span>{inbox} waiting in your inbox</span>
            <span aria-hidden="true">›</span>
          </Link>
        </div>
      )}
    </section>
  );
}

function Facts({
  model,
  n,
  owner,
  now,
}: {
  model: MapModel;
  n: ModelNode;
  owner: string;
  now: number;
}) {
  const topic = model.topics[n.topic]?.name ?? "";
  if (n.locked)
    return (
      <p className={s.meta}>
        {topic}. {owner} has not shared this, so you see where it sits but not
        what it says.
      </p>
    );
  return (
    <>
      <dl className={s.facts}>
        {n.path && (
          <>
            <dt>Path</dt>
            <dd title={n.path}>{n.path}</dd>
          </>
        )}
        <dt>Topic</dt>
        <dd>{topic}</dd>
        <dt>Owner</dt>
        <dd>{owner}</dd>
        <dt>Changed</dt>
        <dd>{date(n.updatedAt, now)}</dd>
      </dl>
      {n.byAgent && <p className={s.meta}>Written by an agent</p>}
    </>
  );
}

function Selected({
  model,
  n,
  status,
  selfHosted,
  now,
  onPick,
  onHot,
  onClear,
}: {
  model: MapModel;
  n: ModelNode;
  status: string;
  selfHosted: boolean;
  now: number;
  onPick: (i: number) => void;
  onHot: (i: number | null) => void;
  onClear: () => void;
}) {
  const nameOf = (id: string | null) =>
    model.members.find((m) => m.id === id)?.name ?? "Someone";
  const owner = nameOf(n.member);
  const nbs = n.nb.map((i) => model.nodes[i]!);
  const nbName = (b: ModelNode) =>
    b.title +
    (b.topic >= 0 && b.kind !== "hub" && b.topic !== n.topic
      ? `, ${model.topics[b.topic]!.name}`
      : "");

  let body;
  if (n.kind === "note" || n.kind === "file")
    body = <Facts model={model} n={n} owner={owner} now={now} />;
  else if (n.kind === "hub")
    body = (
      <p className={s.meta}>
        {model.topics[n.topic]!.count} notes and files in this topic.
      </p>
    );
  else if (n.kind === "agent")
    body = (
      <p className={s.meta}>
        {selfHosted ? "Self-hosted agent" : "Agent"}, {status}. It writes only
        to {owner}&apos;s space.
      </p>
    );
  else
    body = (
      <p className={s.meta}>
        The centre of the map. It links to every topic, and each topic to its
        notes and files.
      </p>
    );

  return (
    <section className={s.sel}>
      <button type="button" className={s.back} onClick={onClear}>
        <span aria-hidden="true">‹</span> Today
      </button>
      <div className={s.selHead}>
        <Shape model={model} n={n} d={9} />
        <h2 className={s.title} title={n.title}>
          {n.title}
        </h2>
      </div>
      {body}
      {n.kind === "note" && !n.locked && n.id && (
        <Link
          href={`/vault?note=${encodeURIComponent(n.id)}`}
          className={`${s.primaryLink} ${s.openLink}`}
        >
          Open in vault
        </Link>
      )}
      {nbs.length > 0 && (
        <div className={s.neighbours}>
          <span className={s.nbTitle}>
            {nbs.length === 1 ? "1 connection" : `${nbs.length} connections`}
          </span>
          {nbs.slice(0, 6).map((b) => (
            <button
              key={b.i}
              type="button"
              className={s.nb}
              onClick={() => onPick(b.i)}
              onPointerEnter={() => onHot(b.i)}
              onPointerLeave={() => onHot(null)}
            >
              <Shape model={model} n={b} d={9} />
              <span className={s.nbName}>{nbName(b)}</span>
            </button>
          ))}
          {nbs.length > 6 && (
            <span className={s.more}>and {nbs.length - 6} more</span>
          )}
        </div>
      )}
      <button type="button" className={s.clear} onClick={onClear}>
        Clear selection
      </button>
    </section>
  );
}

export function DetailRail({
  model,
  act,
  sel,
  agentInfo,
  now,
  inbox = 0,
  onPick,
  onHot,
  onPreview,
  onClear,
}: {
  model: MapModel;
  act: Activity;
  sel: number | null;
  agentInfo: Map<string, { status: string; selfHosted: boolean }>;
  now: number;
  inbox?: number;
  onPick: (i: number) => void;
  onHot: (i: number | null) => void;
  onPreview: (p: Preview | null) => void;
  onClear: () => void;
}) {
  const n = sel !== null ? model.nodes[sel] : undefined;
  const info = n?.kind === "agent" && n.id ? agentInfo.get(n.id) : undefined;
  return (
    <aside aria-label="Details" data-scope="chrome" className={s.details}>
      <div key={sel ?? "today"} className="rise">
        {n ? (
          <Selected
            model={model}
            n={n}
            status={info?.status ?? ""}
            selfHosted={info?.selfHosted ?? false}
            now={now}
            onPick={onPick}
            onHot={onHot}
            onClear={onClear}
          />
        ) : (
          <Today model={model} act={act} inbox={inbox} onPreview={onPreview} />
        )}
      </div>
    </aside>
  );
}
