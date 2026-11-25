import { describe, expect, it } from "vitest";
import {
  COLUMNS,
  columnLabel,
  columnOf,
  pickScale,
  type Scale,
  type Unit,
} from "./timescale";

const DAY = 86_400_000;
/** Tuesday 24 November 2026, 12:00 UTC. */
const NOW = Date.UTC(2026, 10, 24, 12);
const at = (unit: Unit, now = NOW): Scale => ({ unit, now });

describe("pickScale", () => {
  it("has fourteen columns", () => {
    expect(COLUMNS).toBe(14);
  });

  it.each<[string, number, Unit]>([
    ["today", NOW - 60_000, "day"],
    ["13 days back", NOW - 13 * DAY, "day"],
    ["14 days back", NOW - 14 * DAY, "week"],
    ["13 weeks back", NOW - 13 * 7 * DAY, "week"],
    ["14 weeks back", NOW - 14 * 7 * DAY, "month"],
    ["13 months back", Date.UTC(2025, 9, 24), "month"],
    ["14 months back", Date.UTC(2025, 8, 24), "quarter"],
    ["13 quarters back", Date.UTC(2023, 7, 1), "quarter"],
    ["14 quarters back", Date.UTC(2023, 5, 30), "year"],
    ["13 years back", Date.UTC(2013, 0, 1), "year"],
    ["30 years back", Date.UTC(1996, 10, 24), "year"],
    ["nothing (0)", 0, "day"],
    ["a negative time", -5, "day"],
    ["NaN", Number.NaN, "day"],
    ["Infinity", Number.POSITIVE_INFINITY, "day"],
    ["a future time", NOW + 40 * DAY, "day"],
  ])("%s gives %s", (_name, oldest, unit) => {
    expect(pickScale(oldest, NOW)).toEqual({ unit, now: NOW });
  });

  it("falls back to days when now is not a time", () => {
    expect(pickScale(NOW, Number.NaN).unit).toBe("day");
  });

  it("counts days by the UTC calendar, at midnight", () => {
    const now = Date.UTC(2026, 10, 24, 0, 0, 0);
    expect(pickScale(Date.UTC(2026, 10, 11, 0, 0), now).unit).toBe("day");
    expect(pickScale(Date.UTC(2026, 10, 10, 23, 59, 59, 999), now).unit).toBe(
      "week",
    );
  });

  it("starts a week on Monday", () => {
    // Monday 23 November 2026, 00:00: thirteen weeks back starts Monday 24 August.
    const now = Date.UTC(2026, 10, 23);
    expect(pickScale(Date.UTC(2026, 7, 24), now).unit).toBe("week");
    expect(pickScale(Date.UTC(2026, 7, 23, 23, 59), now).unit).toBe("month");
    // Sunday 29 November is still that week.
    const sunday = Date.UTC(2026, 10, 29, 23, 59);
    expect(pickScale(Date.UTC(2026, 7, 24), sunday).unit).toBe("week");
  });

  it("counts months from the first of the month", () => {
    const now = Date.UTC(2026, 10, 1);
    expect(pickScale(Date.UTC(2025, 9, 31, 23, 59), now).unit).toBe("month");
    expect(pickScale(Date.UTC(2025, 8, 30, 23, 59), now).unit).toBe("quarter");
  });

  it("counts quarters and years from 1 January", () => {
    const now = Date.UTC(2027, 0, 1);
    expect(pickScale(Date.UTC(2023, 9, 1), now).unit).toBe("quarter");
    expect(pickScale(Date.UTC(2023, 8, 30, 23, 59), now).unit).toBe("year");
    expect(pickScale(Date.UTC(2013, 11, 31, 23, 59), now).unit).toBe("year");
  });
});

describe("columnOf", () => {
  it.each<[Unit, number, number]>([
    ["day", NOW - DAY, NOW - 13 * DAY],
    ["week", Date.UTC(2026, 10, 22, 23), Date.UTC(2026, 7, 24)],
    ["month", Date.UTC(2026, 9, 31), Date.UTC(2025, 9, 1)],
    ["quarter", Date.UTC(2026, 8, 30), Date.UTC(2023, 6, 1)],
    ["year", Date.UTC(2025, 11, 31), Date.UTC(2013, 0, 1)],
  ])(
    "%s: now is the last column, one back the one before",
    (unit, back, first) => {
      const s = at(unit);
      expect(columnOf(s, NOW)).toBe(13);
      expect(columnOf(s, back)).toBe(12);
      expect(columnOf(s, first)).toBe(0);
      expect(columnOf(s, first - 1)).toBe(0);
      expect(columnOf(s, Date.UTC(1990, 0, 1))).toBe(0);
      expect(columnOf(s, NOW + 400 * DAY)).toBe(13);
    },
  );

  it("puts a time that is not a time in the first column", () => {
    for (const unit of ["day", "week", "month", "quarter", "year"] as const) {
      expect(columnOf(at(unit), Number.NaN)).toBe(0);
      expect(columnOf(at(unit), 0)).toBe(0);
      expect(columnOf(at(unit), Number.NEGATIVE_INFINITY)).toBe(0);
    }
  });

  it("keeps weeks whole across a year boundary", () => {
    // Wednesday 6 January 2027; its week starts Monday 4 January.
    const s = at("week", Date.UTC(2027, 0, 6, 12));
    expect(columnOf(s, Date.UTC(2027, 0, 4))).toBe(13);
    expect(columnOf(s, Date.UTC(2027, 0, 3, 23, 59))).toBe(12);
    expect(columnOf(s, Date.UTC(2026, 11, 31))).toBe(12);
    expect(columnOf(s, Date.UTC(2026, 11, 28))).toBe(12);
    expect(columnOf(s, Date.UTC(2026, 11, 27, 23, 59))).toBe(11);
  });

  it("knows a leap day", () => {
    const now = Date.UTC(2028, 1, 29, 12);
    expect(columnOf(at("day", now), Date.UTC(2028, 1, 28, 23))).toBe(12);
    expect(columnOf(at("day", Date.UTC(2028, 2, 1)), now)).toBe(12);
    expect(columnOf(at("month", now), Date.UTC(2027, 1, 28))).toBe(1);
    expect(columnOf(at("year", now), Date.UTC(2024, 1, 29))).toBe(9);
  });

  it("gives the oldest time a column inside the scale that was picked for it", () => {
    for (const oldest of [
      NOW - 13 * DAY,
      NOW - 14 * DAY,
      NOW - 98 * DAY,
      Date.UTC(2025, 8, 24),
      Date.UTC(2023, 5, 30),
    ]) {
      const s = pickScale(oldest, NOW);
      expect(columnOf(s, oldest - 1)).toBeLessThanOrEqual(columnOf(s, oldest));
      expect(columnOf(s, oldest)).toBeGreaterThanOrEqual(0);
      expect(columnOf(s, oldest)).toBeLessThan(13);
    }
  });
});

describe("columnLabel", () => {
  it("names days as before: Today, the date, the month on the first column and on the 1st", () => {
    const s = at("day");
    expect(columnLabel(s, 13)).toBe("Today");
    expect(columnLabel(s, 12)).toBe("23");
    expect(columnLabel(s, 0)).toBe("11 Nov");
    const dec = at("day", Date.UTC(2026, 11, 3, 8));
    expect(columnLabel(dec, 11)).toBe("1 Dec");
    expect(columnLabel(dec, 10)).toBe("30");
    expect(columnLabel(at("day", Date.UTC(2028, 2, 1)), 12)).toBe("29");
  });

  it("names weeks by the Monday they start on", () => {
    const s = at("week");
    expect(columnLabel(s, 13)).toBe("This week");
    expect(columnLabel(s, 12)).toBe("16 Nov");
    expect(columnLabel(s, 0)).toBe("24 Aug");
    const jan = at("week", Date.UTC(2027, 0, 6, 12));
    expect(columnLabel(jan, 12)).toBe("28 Dec");
  });

  it("names months, with the year on January and on the first column", () => {
    const s = at("month");
    expect(columnLabel(s, 13)).toBe("This month");
    expect(columnLabel(s, 12)).toBe("Oct");
    expect(columnLabel(s, 3)).toBe("Jan 2026");
    expect(columnLabel(s, 2)).toBe("Dec");
    expect(columnLabel(s, 0)).toBe("Oct 2025");
  });

  it("names quarters and years in full", () => {
    expect(columnLabel(at("quarter"), 13)).toBe("Q4 2026");
    expect(columnLabel(at("quarter"), 10)).toBe("Q1 2026");
    expect(columnLabel(at("quarter"), 9)).toBe("Q4 2025");
    expect(columnLabel(at("quarter"), 0)).toBe("Q3 2023");
    expect(columnLabel(at("year"), 13)).toBe("2026");
    expect(columnLabel(at("year"), 0)).toBe("2013");
  });

  it("labels the column a time falls in", () => {
    expect(
      columnLabel(at("month"), columnOf(at("month"), NOW - 60 * DAY)),
    ).toBe("Sep");
    expect(
      columnLabel(at("quarter"), columnOf(at("quarter"), Date.UTC(2025, 1, 3))),
    ).toBe("Q1 2025");
  });
});
