import { describe, expect, it } from "vitest";
import { EARLIEST, cleanDate, dateInPath, noteDates, parseDate } from "./dates";

const NOW = Date.UTC(2026, 10, 24, 9, 30);
const noon = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d, 12);
const iso = (ms: number) => new Date(ms).toISOString();
/** A file time well inside the range, and not a round one. */
const FILE = Date.UTC(2026, 5, 1, 8, 15, 30, 250);

describe("EARLIEST", () => {
  it("is the first moment of 1990, UTC", () => {
    expect(EARLIEST).toBe(Date.UTC(1990, 0, 1));
    expect(iso(EARLIEST)).toBe("1990-01-01T00:00:00.000Z");
  });
});

describe("parseDate", () => {
  it("takes a date with no time of day as 12:00 UTC", () => {
    expect(parseDate("2025-03-14")).toBe(noon(2025, 3, 14));
    expect(parseDate("2025/03/14")).toBe(noon(2025, 3, 14));
    expect(parseDate("2025.03.14")).toBe(noon(2025, 3, 14));
    expect(parseDate("  2025-03-14\n")).toBe(noon(2025, 3, 14));
  });

  it("takes a date and a time, with or without seconds, as UTC", () => {
    expect(parseDate("2025-03-14 09:05")).toBe(Date.UTC(2025, 2, 14, 9, 5));
    expect(parseDate("2025-03-14 09:05:07")).toBe(
      Date.UTC(2025, 2, 14, 9, 5, 7),
    );
    expect(parseDate("2025-03-14T09:05")).toBe(Date.UTC(2025, 2, 14, 9, 5));
    expect(parseDate("2025-03-14T09:05:07")).toBe(
      Date.UTC(2025, 2, 14, 9, 5, 7),
    );
    expect(parseDate("2025-03-14T09:05:07.250")).toBe(
      Date.UTC(2025, 2, 14, 9, 5, 7, 250),
    );
  });

  it("honours Z and an offset of an ISO date-time", () => {
    expect(parseDate("2025-03-14T09:05:07Z")).toBe(
      Date.UTC(2025, 2, 14, 9, 5, 7),
    );
    expect(parseDate("2025-03-14T09:05:07.123456Z")).toBe(
      Date.UTC(2025, 2, 14, 9, 5, 7, 123),
    );
    expect(parseDate("2025-03-14T09:05:07+02:00")).toBe(
      Date.UTC(2025, 2, 14, 7, 5, 7),
    );
    expect(parseDate("2025-03-14T09:05:07-0530")).toBe(
      Date.UTC(2025, 2, 14, 14, 35, 7),
    );
    expect(parseDate("2025-03-14T23:30+03")).toBe(
      Date.UTC(2025, 2, 14, 20, 30),
    );
    // Across midnight into another day.
    expect(parseDate("2025-03-01T00:30:00+02:00")).toBe(
      Date.UTC(2025, 1, 28, 22, 30),
    );
    expect(parseDate("2025-03-14 09:05:07 +02:00")).toBe(
      Date.UTC(2025, 2, 14, 7, 5, 7),
    );
  });

  it("ignores surrounding [[ ]] and quotes", () => {
    expect(parseDate("[[2025-03-14]]")).toBe(noon(2025, 3, 14));
    expect(parseDate('"2025-03-14"')).toBe(noon(2025, 3, 14));
    expect(parseDate("'2025-03-14'")).toBe(noon(2025, 3, 14));
    expect(parseDate('"[[2025-03-14]]"')).toBe(noon(2025, 3, 14));
    expect(parseDate("[[ 2025-03-14 ]]")).toBe(noon(2025, 3, 14));
  });

  it("refuses a date that is not on the calendar", () => {
    for (const v of [
      "2025-02-30",
      "2025-02-29",
      "2025-13-01",
      "2025-00-10",
      "2025-04-31",
      "2025-01-00",
      "2025-01-32",
      "2025-03-14 24:00",
      "2025-03-14 12:60",
      "2025-03-14 12:00:60",
      "2025-03-14T12:00:00+24:00",
      "2025-03-14T12:00:00+02:60",
    ])
      expect(parseDate(v), v).toBeNull();
    // A leap day is one.
    expect(parseDate("2024-02-29")).toBe(noon(2024, 2, 29));
  });

  it("refuses every other text", () => {
    for (const v of [
      "",
      "   ",
      "yesterday",
      "14-03-2025",
      "14/03/2025",
      "March 14, 2025",
      "2025-3-14",
      "25-03-14",
      "2025-03",
      "2025",
      "20250314",
      "2025-03/14",
      "2025/03/14 09:05",
      "2025-03-14 9:05",
      "2025-03-14T09",
      "2025-03-14Z",
      "2025-03-14 and more",
      "x2025-03-14",
      "[[2025-03-14",
      "12025-03-14",
      "2025-03-141",
    ])
      expect(parseDate(v), v).toBeNull();
  });

  it("takes a number as milliseconds, and one below 10^11 as seconds", () => {
    expect(parseDate(1_741_953_600_000)).toBe(1_741_953_600_000);
    expect(parseDate(1_741_953_600)).toBe(1_741_953_600_000);
    expect(parseDate(99_999_999_999)).toBe(99_999_999_999_000);
    expect(parseDate(100_000_000_000)).toBe(100_000_000_000);
    expect(parseDate(1_741_953_600.9)).toBe(1_741_953_600_900);
    for (const v of [Number.NaN, Number.POSITIVE_INFINITY, -Infinity, 1e300])
      expect(parseDate(v), String(v)).toBeNull();
  });

  it("takes a Date, and the first element of a list", () => {
    expect(parseDate(new Date(noon(2025, 3, 14)))).toBe(noon(2025, 3, 14));
    expect(parseDate(new Date(Number.NaN))).toBeNull();
    expect(parseDate(["2025-03-14", "2020-01-01"])).toBe(noon(2025, 3, 14));
    expect(parseDate([1_741_953_600])).toBe(1_741_953_600_000);
    expect(parseDate([])).toBeNull();
    // An unquoted `[[2025-03-14]]` in a note's fields is read by YAML as a list in a list.
    expect(parseDate([["2025-03-14"]])).toBe(noon(2025, 3, 14));
    expect(parseDate([[[["2025-03-14"]]]])).toBeNull();
    expect(parseDate(["nope", "2025-03-14"])).toBeNull();
    const loop: unknown[] = [];
    loop.push(loop);
    expect(parseDate(loop)).toBeNull();
  });

  it("refuses everything that is not a date", () => {
    for (const v of [
      null,
      undefined,
      true,
      false,
      {},
      { date: "2025-03-14" },
      () => "2025-03-14",
      Symbol("2025-03-14"),
      10n,
    ])
      expect(parseDate(v), String(v)).toBeNull();
  });
});

describe("dateInPath", () => {
  it("finds a date in the file name, in each way of writing it", () => {
    for (const path of [
      "2025-03-14.md",
      "2025_03_14.md",
      "2025.03.14.md",
      "20250314.md",
      "2025-03-14 standup.md",
      "standup 2025-03-14.md",
      "standup-20250314-final.md",
      "notes_2025_03_14_v2.md",
      "Daily/x 2025-03-14.md",
    ])
      expect(dateInPath(path, NOW), path).toBe(noon(2025, 3, 14));
  });

  it("does not read a date out of a longer run of digits", () => {
    for (const path of [
      "120250314.md",
      "202503141.md",
      "12025-03-14.md",
      "2025-03-141.md",
      "id 9920250314.md",
      "2025-0314.md",
      "2025-03_14.md",
      "2025-3-14.md",
      "plain.md",
      "",
    ])
      expect(dateInPath(path, NOW), path).toBeNull();
  });

  it("looks at the file name first, then at the folders from the deepest up", () => {
    expect(dateInPath("2021-01-01/2022-02-02/2023-03-03.md", NOW)).toBe(
      noon(2023, 3, 3),
    );
    expect(dateInPath("2021-01-01/2022-02-02/note.md", NOW)).toBe(
      noon(2022, 2, 2),
    );
    expect(dateInPath("2021-01-01/meetings/note.md", NOW)).toBe(
      noon(2021, 1, 1),
    );
    expect(dateInPath("journal/2021/note.md", NOW)).toBeNull();
  });

  it("skips a match that is no date or is out of range, and tries the next", () => {
    // Not on the calendar, then a real one in the same name.
    expect(dateInPath("2025-13-45 2025-03-14.md", NOW)).toBe(noon(2025, 3, 14));
    expect(dateInPath("20251345-20250314.md", NOW)).toBe(noon(2025, 3, 14));
    // Before 1990 and in the future: the folder's date is taken.
    expect(dateInPath("2024-05-06/1989-12-31.md", NOW)).toBe(noon(2024, 5, 6));
    expect(dateInPath("2024-05-06/2031-01-01 plan.md", NOW)).toBe(
      noon(2024, 5, 6),
    );
    expect(dateInPath("1989-12-31.md", NOW)).toBeNull();
    expect(dateInPath("2031-01-01.md", NOW)).toBeNull();
    expect(dateInPath("1990-01-01.md", NOW)).toBe(noon(1990, 1, 1));
  });

  it("skips today's date while it is still before noon UTC, and takes it after", () => {
    expect(dateInPath("2026-11-24.md", NOW)).toBeNull();
    expect(dateInPath("2026-11-24.md", noon(2026, 11, 24))).toBe(
      noon(2026, 11, 24),
    );
    expect(dateInPath("2026-11-23.md", NOW)).toBe(noon(2026, 11, 23));
  });

  it("stops at a date that names today, and does not go on to the folders", () => {
    expect(dateInPath("2023-01-05/2026-11-24.md", NOW)).toBeNull();
    expect(dateInPath("2026-11-24 2023-01-05.md", NOW)).toBeNull();
    // A date further ahead is still skipped, and the next one tried.
    expect(dateInPath("2023-01-05/2026-11-26.md", NOW)).toBe(noon(2023, 1, 5));
  });
});

describe("noteDates", () => {
  const written = (frontmatter: unknown, path = "note.md") =>
    noteDates(frontmatter, path, FILE, NOW).written_at;

  it("reads each of the six field names", () => {
    for (const name of [
      "created",
      "date created",
      "date_created",
      "created_at",
      "creation_date",
      "date",
    ])
      expect(written({ [name]: "2025-03-14" }), name).toBe(
        iso(noon(2025, 3, 14)),
      );
  });

  it("tries the names in the spec's order, whatever the object's order", () => {
    const names = [
      "created",
      "date created",
      "date_created",
      "created_at",
      "creation_date",
      "date",
    ];
    for (let i = 0; i < names.length - 1; i++) {
      // Later names first in the object, each with another date.
      const fields: Record<string, string> = {};
      for (let j = names.length - 1; j >= i; j--)
        fields[names[j]!] = `2020-01-${String(10 + j)}`;
      expect(written(fields), names[i]).toBe(iso(noon(2020, 1, 10 + i)));
    }
    expect(written({ date: "2024-01-01", created: "2023-01-01" })).toBe(
      iso(noon(2023, 1, 1)),
    );
  });

  it("ignores the case of a field's name", () => {
    expect(written({ Created: "2025-03-14" })).toBe(iso(noon(2025, 3, 14)));
    expect(written({ "Date Created": "2025-03-14" })).toBe(
      iso(noon(2025, 3, 14)),
    );
    expect(written({ DATE: "2025-03-14" })).toBe(iso(noon(2025, 3, 14)));
    expect(written({ Created_At: "2025-03-14" })).toBe(iso(noon(2025, 3, 14)));
    // Another field is not one of them.
    expect(written({ updated: "2025-03-14", dated: "2025-03-14" })).toBe(
      iso(FILE),
    );
  });

  it("reads a quoted value, a wiki link, a number, a Date and a list", () => {
    expect(written({ date: "[[2025-03-14]]" })).toBe(iso(noon(2025, 3, 14)));
    expect(written({ date: '"2025-03-14"' })).toBe(iso(noon(2025, 3, 14)));
    expect(written({ date: 1_741_953_600_000 })).toBe(
      "2025-03-14T12:00:00.000Z",
    );
    expect(written({ date: 1_741_953_600 })).toBe("2025-03-14T12:00:00.000Z");
    expect(written({ date: new Date(noon(2025, 3, 14)) })).toBe(
      iso(noon(2025, 3, 14)),
    );
    expect(written({ date: ["2025-03-14", "2019-01-01"] })).toBe(
      iso(noon(2025, 3, 14)),
    );
    expect(written({ created: "2025-03-14 09:05" })).toBe(
      "2025-03-14T09:05:00.000Z",
    );
  });

  it("skips a field that is unusable and goes to the next source", () => {
    // A future field, then a usable one.
    expect(written({ created: "2031-01-01", date: "2025-03-14" })).toBe(
      iso(noon(2025, 3, 14)),
    );
    // Before 1990, not on the calendar, not a date: then the file name.
    for (const bad of ["1989-12-31", "2025-02-30", "soon", 20250314, null, {}])
      expect(
        written({ created: bad }, "Daily/2024-05-06.md"),
        String(bad),
      ).toBe(iso(noon(2024, 5, 6)));
    // Then the folder, then the file's time.
    expect(written({ date: "2031-01-01" }, "2024-05-06/2032-01-01.md")).toBe(
      iso(noon(2024, 5, 6)),
    );
    expect(written({ date: "2031-01-01" }, "2032-01-01.md")).toBe(iso(FILE));
    // The first and the last moment of the range are in it.
    expect(written({ date: "1990-01-01T00:00:00Z" })).toBe(iso(EARLIEST));
    expect(written({ date: "1989-12-31T23:59:59Z" })).toBe(iso(FILE));
    expect(written({ date: iso(NOW) })).toBe(iso(NOW));
    expect(written({ date: iso(NOW + 1) })).toBe(iso(FILE));
  });

  it("puts a field before the file name, and the file name before the file's time", () => {
    expect(written({ date: "2025-03-14" }, "2024-05-06.md")).toBe(
      iso(noon(2025, 3, 14)),
    );
    expect(written({}, "2024-05-06.md")).toBe(iso(noon(2024, 5, 6)));
    expect(written({}, "note.md")).toBe(iso(FILE));
  });

  describe("a date without a time that names today", () => {
    const AT_9 = Date.UTC(2026, 10, 24, 9);
    const MEETING = "2023-01-05 meeting.md";

    it("ends the search before noon UTC: the file's time, not an older source", () => {
      expect(noteDates({ created: "2026-11-24" }, MEETING, FILE, AT_9)).toEqual(
        { written_at: iso(FILE), modified_at: iso(FILE) },
      );
      // A later field is not tried either.
      expect(
        noteDates(
          { created: "2026-11-24", date: "2025-03-14" },
          "note.md",
          FILE,
          AT_9,
        ).written_at,
      ).toBe(iso(FILE));
      // The same for a date in the file name: the folder's date is not taken.
      expect(
        noteDates({}, "2023-01-05/2026-11-24.md", FILE, AT_9).written_at,
      ).toBe(iso(FILE));
      // And for a field that fell through to a name of today.
      expect(
        noteDates({ created: "soon" }, "2023-01-05/2026-11-24.md", FILE, AT_9)
          .written_at,
      ).toBe(iso(FILE));
    });

    it("gives no written date when the file's time is unusable", () => {
      for (const time of [undefined, Number.NaN, 0, AT_9 + 1])
        expect(
          noteDates({ created: "2026-11-24" }, MEETING, time, AT_9),
          String(time),
        ).toEqual({ written_at: null, modified_at: null });
    });

    it("is that day itself from noon UTC on", () => {
      expect(
        noteDates({ created: "2026-11-24" }, MEETING, FILE, noon(2026, 11, 24)),
      ).toEqual({
        written_at: iso(noon(2026, 11, 24)),
        modified_at: iso(noon(2026, 11, 24)),
      });
    });

    it("ends the search for tomorrow's UTC day once it is that day somewhere", () => {
      // 23:00 UTC on the 24th is already the 25th in UTC+14.
      const at23 = Date.UTC(2026, 10, 24, 23);
      expect(noteDates({ created: "2026-11-25" }, MEETING, FILE, at23)).toEqual(
        { written_at: iso(FILE), modified_at: iso(FILE) },
      );
      expect(
        noteDates({ created: "2026-11-25" }, MEETING, undefined, at23),
      ).toEqual({ written_at: null, modified_at: null });
      // From 10:00 UTC on, exactly; a millisecond before, it is a future date.
      const at10 = Date.UTC(2026, 10, 24, 10);
      expect(
        noteDates({ created: "2026-11-25" }, MEETING, FILE, at10).written_at,
      ).toBe(iso(FILE));
      expect(
        noteDates({ created: "2026-11-25" }, MEETING, FILE, at10 - 1)
          .written_at,
      ).toBe(iso(noon(2023, 1, 5)));
    });

    it("skips a date further ahead and tries the next source", () => {
      expect(
        noteDates({ created: "2026-11-26" }, MEETING, FILE, AT_9).written_at,
      ).toBe(iso(noon(2023, 1, 5)));
      expect(
        noteDates(
          { created: "2026-11-26", date: "2025-03-14" },
          MEETING,
          FILE,
          AT_9,
        ).written_at,
      ).toBe(iso(noon(2025, 3, 14)));
    });

    it("leaves a date with a time, a number and a Date as they were", () => {
      // In the future, however near: skipped, and the name's date is used.
      for (const v of [
        "2026-11-24T10:00:00Z",
        "2026-11-24 12:00",
        AT_9 + 1,
        new Date(noon(2026, 11, 24)),
      ])
        expect(
          noteDates({ created: v }, MEETING, FILE, AT_9).written_at,
          String(v),
        ).toBe(iso(noon(2023, 1, 5)));
      expect(
        noteDates({ created: "2026-11-24T08:00:00Z" }, MEETING, FILE, AT_9)
          .written_at,
      ).toBe("2026-11-24T08:00:00.000Z");
      // A past date without a time is that day, whatever the hour.
      expect(
        noteDates({ created: "2026-11-23" }, MEETING, FILE, AT_9).written_at,
      ).toBe(iso(noon(2026, 11, 23)));
    });
  });

  it("gives the file's time as the last change", () => {
    expect(noteDates({ date: "2025-03-14" }, "note.md", FILE, NOW)).toEqual({
      written_at: iso(noon(2025, 3, 14)),
      modified_at: iso(FILE),
    });
    expect(noteDates({}, "note.md", FILE, NOW)).toEqual({
      written_at: iso(FILE),
      modified_at: iso(FILE),
    });
  });

  it("never gives a last change before the written date", () => {
    const old = Date.UTC(2020, 0, 1);
    expect(noteDates({ date: "2025-03-14" }, "note.md", old, NOW)).toEqual({
      written_at: iso(noon(2025, 3, 14)),
      modified_at: iso(noon(2025, 3, 14)),
    });
  });

  it("gives no last change when the file's time is unusable", () => {
    for (const time of [
      undefined,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      0,
      -1,
      EARLIEST - 1,
      NOW + 1,
      "2025-03-14" as never,
      null as never,
    ])
      expect(
        noteDates({ date: "2025-03-14" }, "note.md", time, NOW),
        String(time),
      ).toEqual({ written_at: iso(noon(2025, 3, 14)), modified_at: null });
  });

  it("gives nulls when no source is usable", () => {
    for (const fields of [{}, null, undefined, "date: 2025-03-14", 7, []])
      expect(noteDates(fields, "note.md", undefined, NOW)).toEqual({
        written_at: null,
        modified_at: null,
      });
    expect(
      noteDates({ date: "2031-01-01" }, "2032-01-01.md", NOW + 5, NOW),
    ).toEqual({ written_at: null, modified_at: null });
  });

  it("does not throw on hostile input, and answers quickly", () => {
    const throwing = {
      get created(): string {
        throw new Error("boom");
      },
      date: "2025-03-14",
    };
    const proxy = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("boom");
        },
        get() {
          throw new Error("boom");
        },
      },
    );
    const started = performance.now();
    // A field that cannot be read is skipped; the next name is still tried.
    expect(noteDates(throwing, "note.md", FILE, NOW)).toEqual({
      written_at: iso(noon(2025, 3, 14)),
      modified_at: iso(FILE),
    });
    expect(noteDates(proxy, "note.md", FILE, NOW)).toEqual({
      written_at: iso(FILE),
      modified_at: iso(FILE),
    });
    const long = "2025-03-14".padEnd(1_000_000, "1");
    const digits = "20250314".repeat(125_000);
    expect(parseDate(long)).toBeNull();
    expect(parseDate("[".repeat(1_000_000))).toBeNull();
    expect(parseDate(" ".repeat(1_000_000) + "2025-03-14")).toBeNull();
    expect(noteDates({ date: long }, long, FILE, NOW).written_at).toBe(
      iso(FILE),
    );
    expect(dateInPath(digits, NOW)).toBeNull();
    expect(dateInPath("/".repeat(1_000_000), NOW)).toBeNull();
    expect(dateInPath("2025-13-45 ".repeat(100_000), NOW)).toBeNull();
    expect(dateInPath(7 as never, NOW)).toBeNull();
    expect(noteDates({}, null as never, FILE, Number.NaN)).toEqual({
      written_at: null,
      modified_at: null,
    });
    expect(cleanDate(long, NOW)).toBeNull();
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

describe("cleanDate", () => {
  it("answers the time as an ISO text of its own making", () => {
    expect(cleanDate("2025-03-14T12:00:00.000Z", NOW)).toBe(
      "2025-03-14T12:00:00.000Z",
    );
    expect(cleanDate("2025-03-14", NOW)).toBe("2025-03-14T12:00:00.000Z");
    expect(cleanDate("2025-03-14T09:05:07+02:00", NOW)).toBe(
      "2025-03-14T07:05:07.000Z",
    );
    expect(cleanDate(iso(EARLIEST), NOW)).toBe(iso(EARLIEST));
    expect(cleanDate(iso(NOW), NOW)).toBe(iso(NOW));
  });

  it("refuses what is out of range, too long, unparseable or not a text", () => {
    for (const v of [
      iso(EARLIEST - 1),
      iso(NOW + 1),
      "2031-01-01",
      "2025-02-30",
      "soon",
      "",
      "2025-03-14T12:00:00.000Z; drop table notes",
      "2025-03-14T12:00:00.000000000000000000000Z",
      1_741_953_600_000,
      new Date(noon(2025, 3, 14)),
      ["2025-03-14"],
      null,
      undefined,
      {},
    ])
      expect(cleanDate(v, NOW), String(v)).toBeNull();
    // 40 characters are taken, 41 are not.
    const padded = (n: number) => "2025-03-14".padStart(n, " ");
    expect(cleanDate(padded(40), NOW)).toBe("2025-03-14T12:00:00.000Z");
    expect(cleanDate(padded(41), NOW)).toBeNull();
    expect(cleanDate("2025-03-14", Number.NaN)).toBeNull();
  });
});
