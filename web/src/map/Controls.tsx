// The map's top bar: the view switch, Group by (Rings only), the filter (FilterBar.tsx: search
// with the Filter button, the chips and the count) and the Today button. On a narrow card the
// filter drops to a second row.
import { useRef } from "react";
import type { View } from "./types";
import type { Arrange } from "./arrange";
import { GroupMenu } from "./GroupMenu";
import { useSlidingPill } from "../shell/useSlidingPill";
import pill from "../shell/SlidingPill.module.css";
import s from "./map.module.css";

export const VIEWS: [View, string][] = [
  ["rings", "Rings"],
  ["timeline", "Timeline"],
  ["orbit", "Orbit"],
];

export function TopBar({
  view,
  onView,
  arrange,
  onArrange,
  filter,
  today,
}: {
  view: View;
  onView: (v: View) => void;
  arrange: Arrange;
  onArrange: (a: Arrange) => void;
  /** The filter: search, the Filter button and its popover, the chips and the count. */
  filter: React.ReactNode;
  /** The Today button, last in the bar. */
  today: React.ReactNode;
}) {
  const group = useRef<HTMLDivElement>(null);
  const pillStyle = useSlidingPill(group, '[aria-pressed="true"]', view);
  return (
    <div className={s.bar} data-map-bar="">
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
        <GroupMenu arrange={arrange} onArrange={onArrange} />
      )}
      {filter}
      {today}
    </div>
  );
}
