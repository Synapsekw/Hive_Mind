// The controls around the stage: stats line, view switch, labels toggle and search on top;
// the filter bar (FilterBar.tsx) sits on the stage.
import { useRef } from "react";
import type { View } from "./types";
import { ARRANGES, type Arrange } from "./arrange";
import { useSlidingPill } from "../shell/useSlidingPill";
import pill from "../shell/SlidingPill.module.css";
import s from "./map.module.css";

export const VIEWS: [View, string][] = [
  ["rings", "Rings"],
  ["timeline", "Timeline"],
  ["orbit", "Orbit"],
];

export function TopBar({
  stats,
  view,
  onView,
  arrange,
  onArrange,
  names,
  onNames,
  q,
  onQ,
}: {
  stats: string;
  view: View;
  onView: (v: View) => void;
  arrange: Arrange;
  onArrange: (a: Arrange) => void;
  names: boolean;
  onNames: () => void;
  q: string;
  onQ: (q: string) => void;
}) {
  const group = useRef<HTMLDivElement>(null);
  const pillStyle = useSlidingPill(group, '[aria-pressed="true"]', view);
  const arrangeGroup = useRef<HTMLDivElement>(null);
  const arrangePill = useSlidingPill(
    arrangeGroup,
    '[aria-pressed="true"]',
    `${view}:${arrange}`,
  );
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
      {view === "rings" && (
        <div className={s.arrange}>
          <span aria-hidden="true" className={s.arrangeLabel}>
            Arrange by
          </span>
          <div
            ref={arrangeGroup}
            role="group"
            aria-label="Arrange by"
            className={s.switch}
          >
            <span
              aria-hidden="true"
              className={pill.pill}
              style={arrangePill}
            />
            {ARRANGES.map(([a, name]) => (
              <button
                key={a}
                type="button"
                className={s.tab}
                aria-pressed={arrange === a}
                onClick={() => onArrange(a)}
              >
                {name}
              </button>
            ))}
          </div>
        </div>
      )}
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
