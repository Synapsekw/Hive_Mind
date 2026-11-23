// The controls around the stage: stats line, view switch, labels toggle and search on top;
// topic, kind and person chips below. Picking a chip dims everything else; nothing is hidden.
import { useRef, type CSSProperties } from "react";
import type { MapModel, NodeKind, View } from "./types";
import { useSlidingPill } from "../shell/useSlidingPill";
import pill from "../shell/SlidingPill.module.css";
import s from "./map.module.css";

export const VIEWS: [View, string][] = [
  ["hive", "Hive"],
  ["rings", "Rings"],
  ["topics", "Topics"],
  ["links", "Links"],
  ["timeline", "Timeline"],
  ["orbit", "Orbit"],
];

const KINDS: [NodeKind, string][] = [
  ["note", "Notes"],
  ["file", "Files"],
  ["hub", "Topics"],
  ["agent", "Agents"],
];

export function TopBar({
  stats,
  view,
  onView,
  names,
  onNames,
  q,
  onQ,
}: {
  stats: string;
  view: View;
  onView: (v: View) => void;
  names: boolean;
  onNames: () => void;
  q: string;
  onQ: (q: string) => void;
}) {
  const group = useRef<HTMLDivElement>(null);
  const pillStyle = useSlidingPill(group, '[aria-pressed="true"]', view);
  return (
    <div className={s.bar}>
      <p className={s.stats} aria-live="polite">
        {stats}
      </p>
      <div ref={group} role="group" aria-label="View" className={s.switch}>
        <span aria-hidden="true" className={pill.pill} style={pillStyle} />
        {VIEWS.map(([v, name]) => (
          <button
            key={v}
            type="button"
            className={s.tab}
            aria-pressed={view === v}
            onClick={() => onView(v)}
          >
            {name}
          </button>
        ))}
      </div>
      <div className={s.tools}>
        <button
          type="button"
          className={s.toggle}
          aria-pressed={names}
          onClick={onNames}
        >
          Labels
        </button>
        <label htmlFor="hv-search" className={s.srOnly}>
          Search
        </label>
        <input
          id="hv-search"
          type="search"
          placeholder="Search"
          autoComplete="off"
          className={s.search}
          value={q}
          onChange={(e) => onQ(e.target.value)}
        />
      </div>
    </div>
  );
}

function Chip({
  name,
  on,
  quiet,
  onClick,
  dot,
}: {
  name: string;
  on: boolean;
  quiet: boolean;
  onClick: () => void;
  dot?: { colour?: string; kind?: NodeKind };
}) {
  return (
    <button
      type="button"
      className={s.chip}
      aria-pressed={on}
      data-quiet={quiet || undefined}
      onClick={onClick}
    >
      {dot && (
        <span
          aria-hidden="true"
          className={s.chipDot}
          data-kind={dot.kind}
          style={dot.colour ? ({ "--c": dot.colour } as CSSProperties) : {}}
        />
      )}
      {name}
    </button>
  );
}

export function Chips({
  model,
  topic,
  onTopic,
  kind,
  onKind,
  member,
  onMember,
}: {
  model: MapModel;
  topic: number | null;
  onTopic: (t: number | null) => void;
  kind: NodeKind | null;
  onKind: (k: NodeKind | null) => void;
  member: string | null;
  onMember: (m: string | null) => void;
}) {
  if (model.nodes.length <= 1) return null;
  return (
    <>
      <div role="group" aria-label="Topics" className={s.chips}>
        {model.topics.map((t, i) => (
          <Chip
            key={i}
            name={t.name}
            on={topic === i}
            quiet={topic !== null && topic !== i}
            onClick={() => onTopic(topic === i ? null : i)}
            dot={{ colour: `var(--hue-${t.hue + 1})` }}
          />
        ))}
      </div>
      <div className={s.chips}>
        <div role="group" aria-label="Kinds" className={s.chips}>
          {KINDS.map(([k, name]) => (
            <Chip
              key={k}
              name={name}
              on={kind === k}
              quiet={kind !== null && kind !== k}
              onClick={() => onKind(kind === k ? null : k)}
              dot={{ kind: k }}
            />
          ))}
        </div>
        <span aria-hidden="true" className={s.sep} />
        <div role="group" aria-label="People" className={s.chips}>
          {model.members.map((m) => (
            <Chip
              key={m.id}
              name={m.name}
              on={member === m.id}
              quiet={member !== null && member !== m.id}
              onClick={() => onMember(member === m.id ? null : m.id)}
            />
          ))}
        </div>
        <span aria-hidden="true" className={s.sep} />
        <span className={s.legend}>
          <span aria-hidden="true" className={s.legendDot} />
          Not shared with you
        </span>
      </div>
    </>
  );
}
