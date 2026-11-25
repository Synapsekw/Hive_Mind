// The Today button, last in the map's top bar: opens and closes the side panel. Its name is
// today's writes and what waits for the person; the visible word and number are for the eye.
import { todayName } from "./todayName";
import s from "./map.module.css";

export function TodayButton({
  today,
  needs,
  open,
  controls,
  onToggle,
}: {
  today: number;
  needs: number;
  open: boolean;
  controls: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      data-today=""
      className={s.todayBtn}
      aria-label={todayName(today, needs)}
      aria-expanded={open}
      aria-controls={controls}
      aria-keyshortcuts="]"
      onClick={onToggle}
    >
      <span aria-hidden="true" className={s.todayBtnWord}>
        Today
      </span>
      <span aria-hidden="true">{today}</span>
      {needs > 0 && <span aria-hidden="true" className={s.todayBtnDot} />}
    </button>
  );
}
