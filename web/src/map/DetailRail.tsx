// The right rail: today's activity until something is selected, then what it is, who wrote
// it and what it connects to. Every title is rendered as a text node.
import type { Activity, MapModel, ModelNode } from "./types";
import { Shape } from "./Dots";
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

function Today({ model, act }: { model: MapModel; act: Activity }) {
  if (act.today === 0)
    return (
      <section className={s.today}>
        <p className={s.quiet}>Nothing written today.</p>
      </section>
    );
  const max = Math.max(1, ...act.perMember.map((m) => m.count));
  const me = new Set(model.members.filter((m) => m.isMe).map((m) => m.id));
  return (
    <section className={s.today}>
      <div>
        <div className={s.big}>{act.today}</div>
        <p className={s.bigNote}>notes written or changed today</p>
      </div>
      <div className={s.bars}>
        {act.perMember.map((m) => (
          <div key={m.id} style={{ display: "contents" }}>
            <span>{m.name}</span>
            <span aria-hidden="true" className={s.track}>
              <span
                className={s.fill}
                data-me={me.has(m.id) || undefined}
                style={{ width: `${(100 * m.count) / max}%` }}
              />
            </span>
            <span className={s.count}>{m.count}</span>
          </div>
        ))}
      </div>
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
  onClear,
}: {
  model: MapModel;
  n: ModelNode;
  status: string;
  selfHosted: boolean;
  now: number;
  onPick: (i: number) => void;
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
      <div className={s.selHead}>
        <Shape model={model} n={n} d={9} />
        <h2 className={s.title} title={n.title}>
          {n.title}
        </h2>
      </div>
      {body}
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
  onPick,
  onClear,
}: {
  model: MapModel;
  act: Activity;
  sel: number | null;
  agentInfo: Map<string, { status: string; selfHosted: boolean }>;
  now: number;
  onPick: (i: number) => void;
  onClear: () => void;
}) {
  const n = sel !== null ? model.nodes[sel] : undefined;
  const info = n?.kind === "agent" && n.id ? agentInfo.get(n.id) : undefined;
  return (
    <aside aria-label="Details" className={s.details}>
      {n ? (
        <Selected
          model={model}
          n={n}
          status={info?.status ?? ""}
          selfHosted={info?.selfHosted ?? false}
          now={now}
          onPick={onPick}
          onClear={onClear}
        />
      ) : (
        <Today model={model} act={act} />
      )}
    </aside>
  );
}
