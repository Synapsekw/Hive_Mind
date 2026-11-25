// The Timeline's scale: which unit a column stands for, the column of a moment and the label of
// a column. Pure; all calendar arithmetic is UTC.

export type Unit = "day" | "week" | "month" | "quarter" | "year";

/** Number of columns in the Timeline; the last one is the current day, week, month, ... */
export const COLUMNS = 14;

export type Scale = { unit: Unit; now: number };

const DAY_MS = 86_400_000;
const UNITS: Unit[] = ["day", "week", "month", "quarter", "year"];
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

/**
 * A whole number per unit that grows by one from each unit to the next: days since the epoch,
 * weeks (Monday to Sunday) since the week of the epoch, months, quarters or years since year 0.
 */
function ordinal(unit: Unit, t: number): number {
  if (unit === "day") return Math.floor(t / DAY_MS);
  // 1 January 1970 was a Thursday: the Monday of that week is three days before the epoch.
  if (unit === "week") return Math.floor((Math.floor(t / DAY_MS) + 3) / 7);
  const d = new Date(t);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  if (unit === "month") return y * 12 + m;
  if (unit === "quarter") return y * 4 + Math.floor(m / 3);
  return y;
}

/**
 * The smallest unit in which `oldest` falls within COLUMNS columns counting the current one;
 * "day" when there is nothing or `oldest` is not a finite positive time; "year" beyond that.
 */
export function pickScale(oldest: number, now: number): Scale {
  if (!Number.isFinite(now) || !Number.isFinite(oldest) || oldest <= 0)
    return { unit: "day", now };
  for (const unit of UNITS)
    if (ordinal(unit, now) - ordinal(unit, oldest) <= COLUMNS - 1)
      return { unit, now };
  return { unit: "year", now };
}

/**
 * 0..COLUMNS-1; COLUMNS-1 is the current unit; older than the first column gives 0; a time
 * after now gives COLUMNS-1. A time that is not a time gives 0.
 */
export function columnOf(scale: Scale, t: number): number {
  if (!Number.isFinite(t)) return 0;
  if (t >= scale.now) return COLUMNS - 1;
  const ago = ordinal(scale.unit, scale.now) - ordinal(scale.unit, t);
  if (!Number.isFinite(ago)) return 0;
  return Math.max(0, Math.min(COLUMNS - 1, COLUMNS - 1 - ago));
}

/**
 * The label of a column. Days: "Today", the date, with the month on the first column and on the
 * 1st. Weeks: "This week" and the Monday a week starts on ("3 Nov"). Months: "This month" and the
 * short name, with the year on January and on the first column. Quarters "Q4 2026"; years "2026".
 */
export function columnLabel(scale: Scale, column: number): string {
  const { unit, now } = scale;
  const last = column === COLUMNS - 1;
  const o = ordinal(unit, now) - (COLUMNS - 1 - column);
  if (unit === "day") {
    if (last) return "Today";
    const d = new Date(o * DAY_MS);
    const day = d.getUTCDate();
    return column === 0 || day === 1
      ? `${day} ${MONTHS[d.getUTCMonth()]}`
      : `${day}`;
  }
  if (unit === "week") {
    if (last) return "This week";
    const d = new Date((o * 7 - 3) * DAY_MS);
    return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  }
  if (unit === "month") {
    if (last) return "This month";
    const y = Math.floor(o / 12);
    const m = o - y * 12;
    return column === 0 || m === 0 ? `${MONTHS[m]} ${y}` : `${MONTHS[m]}`;
  }
  if (unit === "quarter") {
    const y = Math.floor(o / 4);
    return `Q${o - y * 4 + 1} ${y}`;
  }
  return `${o}`;
}
