import { describe, expect, it } from "vitest";
import {
  applyFilters,
  dateBounds,
  DEFAULT_FILTERS,
  folderTree,
  fromQuery,
  groupBySession,
  needsServer,
  toQuery,
  toServerFilter,
} from "./filters";
import type { Filters, GalleryFile, GallerySession } from "./types";

const NOW = Date.UTC(2026, 10, 24, 12);
const day = (d: number) => new Date(NOW - d * 86_400_000).toISOString();
const f = (over: Partial<GalleryFile>): GalleryFile => ({
  id: over.name ?? "x",
  name: "x",
  kind: "pdf",
  size: 1,
  created_at: day(0),
  owner: "Dani",
  owner_id: "m1",
  mine: true,
  note: null,
  sharing: "private",
  thumb: null,
  session_id: null,
  refs: [],
  folders: [],
  ...over,
});
const S = (
  id: string,
  start: number,
  agent = "Mac Claude",
): GallerySession => ({
  id,
  title: id,
  agent,
  started_at: day(start),
  ended_at: null,
  note: null,
  mine: true,
});
const sessions = new Map([
  ["s1", S("s1", 1)],
  ["s2", S("s2", 0, "ChatGPT")],
]);
const none = () => new Set<string>();
const with_ = (over: Partial<Filters>): Filters => ({
  ...DEFAULT_FILTERS,
  ...over,
});

describe("query round-trip", () => {
  it("writes only what differs from the default and reads it back", () => {
    const x = with_({
      view: "grid",
      kinds: ["pdf", "slides"],
      date: "month",
      session: "s1",
      q: "acme",
    });
    const q = toQuery(x);
    expect(q).toBe("view=grid&kinds=pdf%2Cslides&date=month&session=s1&q=acme");
    expect(fromQuery(new URLSearchParams(q))).toEqual(x);
  });
  it("drops unknown values", () => {
    expect(
      fromQuery(
        new URLSearchParams("view=bad&kinds=pdf,evil&date=never&scope=x"),
      ),
    ).toEqual(with_({ kinds: ["pdf"] }));
  });
  it("keeps a range only with both ends as dates", () => {
    expect(
      fromQuery(
        new URLSearchParams("date=range&from=2026-11-01&to=2026-11-20"),
      ),
    ).toEqual(with_({ date: "range", from: "2026-11-01", to: "2026-11-20" }));
    expect(fromQuery(new URLSearchParams("date=range&from=nope")).date).toBe(
      "any",
    );
  });
});

describe("range validation", () => {
  it.each([
    "date=range&from=2026-13-45&to=2026-13-46",
    "date=range&from=2026-02-31&to=2026-03-01",
    "date=range&from=2026-11-20&to=2026-11-01",
  ])("falls back to any for %s", (q) => {
    const x = fromQuery(new URLSearchParams(q));
    expect(x).toEqual(DEFAULT_FILTERS);
    expect(() => toServerFilter(x, NOW)).not.toThrow();
  });
});

describe("dateBounds", () => {
  it("today is the current UTC day", () => {
    const b = dateBounds(with_({ date: "today" }), NOW)!;
    expect(new Date(b.from).toISOString()).toBe("2026-11-24T00:00:00.000Z");
    expect(new Date(b.to).toISOString()).toBe("2026-11-25T00:00:00.000Z");
  });
  it("week is seven days including today; any is null", () => {
    expect(
      new Date(dateBounds(with_({ date: "week" }), NOW)!.from).toISOString(),
    ).toBe("2026-11-18T00:00:00.000Z");
    expect(dateBounds(DEFAULT_FILTERS, NOW)).toBeNull();
  });
});

describe("applyFilters", () => {
  const files = [
    f({ name: "a.pdf", kind: "pdf", session_id: "s1", created_at: day(1) }),
    f({
      name: "b.pptx",
      kind: "slides",
      session_id: "s2",
      mine: false,
      owner_id: "m2",
    }),
    f({ name: "c.png", kind: "image", created_at: day(40), folders: ["fold"] }),
  ];
  const names = (x: Filters) =>
    applyFilters(
      files,
      x,
      sessions,
      (id) => new Set(id === "fold" ? ["c.png"] : []),
      NOW,
    ).map((v) => v.name);
  it("kinds are OR within, AND with the rest", () => {
    expect(names(with_({ kinds: ["pdf", "slides"] }))).toEqual([
      "a.pdf",
      "b.pptx",
    ]);
    expect(names(with_({ kinds: ["pdf", "slides"], scope: "mine" }))).toEqual([
      "a.pdf",
    ]);
  });
  it("filters by date, session, agent, owner, folder and name", () => {
    expect(names(with_({ date: "month" }))).toEqual(["a.pdf", "b.pptx"]);
    expect(names(with_({ session: "s2" }))).toEqual(["b.pptx"]);
    expect(names(with_({ agent: "Mac Claude" }))).toEqual(["a.pdf"]);
    expect(names(with_({ owner: "m2" }))).toEqual(["b.pptx"]);
    expect(names(with_({ folder: "fold" }))).toEqual(["c.png"]);
    expect(names(with_({ q: " B.PP " }))).toEqual(["b.pptx"]);
  });
});

describe("groupBySession", () => {
  it("orders groups newest session first, files without a session last", () => {
    const g = groupBySession(
      [
        f({ name: "a", session_id: "s1" }),
        f({ name: "b", session_id: "s2" }),
        f({ name: "c" }),
      ],
      sessions,
    );
    expect(g.map((x) => x.session?.id ?? null)).toEqual(["s2", "s1", null]);
  });
});

describe("needsServer", () => {
  it("never when everything is loaded; only for server-side filters otherwise", () => {
    expect(needsServer(with_({ kinds: ["pdf"] }), true)).toBe(false);
    expect(needsServer(with_({ kinds: ["pdf"] }), false)).toBe(true);
    expect(
      needsServer(with_({ q: "x", view: "grid", scope: "mine" }), false),
    ).toBe(false);
  });
});

describe("toServerFilter", () => {
  it("turns presets into instants and passes the agent and the folder", () => {
    const s = toServerFilter(
      with_({
        date: "today",
        kinds: ["pdf"],
        agent: "Mac Claude",
        folder: "fold",
      }),
      NOW,
    );
    expect(s).toEqual({
      kinds: ["pdf"],
      session: null,
      owner: null,
      agent: "Mac Claude",
      folder: "fold",
      from: "2026-11-24T00:00:00.000Z",
      to: "2026-11-25T00:00:00.000Z",
    });
  });

  it("asks the server for every filter needsServer counts, the agent included", () => {
    const s = toServerFilter(with_({ agent: "Codex" }), NOW);
    expect(needsServer(with_({ agent: "Codex" }), false)).toBe(true);
    expect(s.agent).toBe("Codex");
    expect(toServerFilter(DEFAULT_FILTERS, NOW)).toEqual({
      kinds: [],
      session: null,
      owner: null,
      agent: null,
      folder: null,
      from: null,
      to: null,
    });
  });
});

describe("folderTree", () => {
  it("nests one level, sorted by name", () => {
    const t = folderTree([
      { id: "2", name: "beta", parent_id: null },
      { id: "1", name: "Alpha", parent_id: null },
      { id: "3", name: "child", parent_id: "1" },
    ]);
    expect(
      t.map((x) => [x.folder.name, x.children.map((c) => c.name)]),
    ).toEqual([
      ["Alpha", ["child"]],
      ["beta", []],
    ]);
  });
});
