// The controls around the stage: stats line, view switch, labels toggle and search on top;
// the legend dock (Dock.tsx) sits on the stage.
import { useRef } from "react";
import type { View } from "./types";
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
