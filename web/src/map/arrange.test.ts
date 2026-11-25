import { describe, expect, it } from "vitest";
import {
  ARRANGES,
  GROUP_HEADING,
  grouping,
  ofKind,
  topicKinds,
} from "./arrange";
import type { Kind } from "../topics/types";
import type { MapNode } from "./types";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 24, 12);
const node = (id: string, over: Partial<MapNode> = {}): MapNode => ({
  id,
  kind: "note",
  topic: "General",
  member_id: "m1",
  updated_at: new Date(NOW).toISOString(),
  locked: false,
  title: id,
  path: `${id}.md`,
  workspace_id: "w1",
  by_agent: false,
  agent_id: null,
  note_id: null,
  ...over,
});
const link = (from: string, to: string) => ({ from, to, tier: 1, score: 1 });
const sizes = (g: { names: string[]; of: number[] }) =>
  g.names.map((_, i) => g.of.filter((x) => x === i).length);

const many = (prefix: string, n: number, over: Partial<MapNode> = {}) =>
  Array.from({ length: n }, (_, i) => node(`${prefix}-${i}`, over));

/** Topics t01..t14 with 14, 13, ... 1 items; `rename` swaps one topic's name. */
const topicNodes = (rename?: [string, string]) =>
  Array.from({ length: 14 }, (_, t) => {
    const name = `t${String(t + 1).padStart(2, "0")}`;
    const topic = rename && rename[0] === name ? rename[1] : name;
    return many(name, 14 - t, { topic });
  }).flat();

describe("grouping by folder", () => {
  it("orders topics by count then name", () => {
    const nodes = [
      ...many("b", 2, { topic: "B" }),
      ...many("c", 2, { topic: "C" }),
      ...many("a", 3, { topic: "A" }),
    ];
    const g = grouping({ nodes, links: [] }, "folder", NOW);
    expect(g.names).toEqual(["A", "B", "C"]);
    expect(sizes(g)).toEqual([3, 2, 2]);
    expect(g.of).toHaveLength(nodes.length);
  });

  it("folds the tail into Other past the cap", () => {
    const g = grouping({ nodes: topicNodes(), links: [] }, "folder", NOW);
    expect(g.names).toEqual([
      "t01",
      "t02",
      "t03",
      "t04",
      "t05",
      "t06",
      "t07",
      "t08",
      "t09",
      "t10",
      "t11",
      "Other",
    ]);
    // t12 + t13 + t14 hold 3 + 2 + 1 items.
    expect(sizes(g)).toEqual([14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 6]);
  });

  it("calls the fold Other topics when a real topic is named Other", () => {
    const g = grouping(
      { nodes: topicNodes(["t05", "Other"]), links: [] },
      "folder",
      NOW,
    );
    expect(g.names).toHaveLength(12);
    expect(g.names[4]).toBe("Other");
    expect(g.names[11]).toBe("Other topics");
    expect(sizes(g)[4]).toBe(10);
    expect(sizes(g)[11]).toBe(6);
  });

  it("honours a smaller max", () => {
    const g = grouping({ nodes: topicNodes(), links: [] }, "folder", NOW, 8);
    expect(g.names).toEqual([
      "t01",
      "t02",
      "t03",
      "t04",
      "t05",
      "t06",
      "t07",
      "Other",
    ]);
    expect(sizes(g)).toEqual([14, 13, 12, 11, 10, 9, 8, 28]);
  });
});

describe("grouping by time", () => {
  it("splits Last 2 weeks from months, boundary inclusive", () => {
    const nodes = [
      node("now"),
      node("edge", {
        updated_at: new Date(NOW - 14 * DAY).toISOString(),
      }),
      node("nov", { updated_at: new Date(NOW - 15 * DAY).toISOString() }),
      node("oct", { updated_at: new Date(NOW - 50 * DAY).toISOString() }),
    ];
    const g = grouping({ nodes, links: [] }, "time", NOW);
    expect(g.names).toEqual(["Last 2 weeks", "November 2026", "October 2026"]);
    expect(sizes(g)).toEqual([2, 1, 1]);
    expect(g.of).toEqual([0, 0, 1, 2]);
  });

  it("orders months newest first even when an older month is bigger", () => {
    const nov = new Date(NOW - 15 * DAY).toISOString();
    const oct = new Date(NOW - 50 * DAY).toISOString();
    const nodes = [
      ...many("o", 3, { updated_at: oct }),
      node("n", { updated_at: nov }),
    ];
    const g = grouping({ nodes, links: [] }, "time", NOW);
    expect(g.names).toEqual(["November 2026", "October 2026"]);
    expect(sizes(g)).toEqual([1, 3]);
  });

  it("folds old months into Earlier past the cap", () => {
    const nodes = Array.from({ length: 14 }, (_, m) =>
      node(`m${m}`, {
        updated_at: new Date(Date.UTC(2025, m, 15)).toISOString(),
      }),
    );
    const g = grouping({ nodes, links: [] }, "time", NOW);
    expect(g.names).toHaveLength(12);
    expect(g.names[0]).toBe("February 2026");
    expect(g.names[10]).toBe("April 2025");
    expect(g.names[11]).toBe("Earlier");
    expect(sizes(g)).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 3]);
  });

  it("puts an unparsable time in the oldest month, or Earlier", () => {
    const old = new Date(NOW - 50 * DAY).toISOString();
    const withMonth = grouping(
      {
        nodes: [
          node("a", { updated_at: old }),
          node("b", { updated_at: "nope" }),
        ],
        links: [],
      },
      "time",
      NOW,
    );
    expect(withMonth.names).toEqual(["October 2026"]);
    expect(sizes(withMonth)).toEqual([2]);

    const none = grouping(
      {
        nodes: [node("a"), node("b", { updated_at: "nope" })],
        links: [],
      },
      "time",
      NOW,
    );
    expect(none.names).toEqual(["Last 2 weeks", "Earlier"]);
    expect(sizes(none)).toEqual([1, 1]);
  });

  it("groups by the created date, not the last change", () => {
    const today = new Date(NOW).toISOString();
    const nodes = [
      // Written in March 2025 and changed today: March 2025.
      node("old", {
        created_at: "2025-03-14T12:00:00.000Z",
        updated_at: today,
      }),
      // Written today: the last two weeks.
      node("new", { created_at: today, updated_at: today }),
      // No usable created date: the last change decides.
      node("absent", { updated_at: new Date(NOW - 50 * DAY).toISOString() }),
      node("null", {
        created_at: null,
        updated_at: new Date(NOW - 50 * DAY).toISOString(),
      }),
      node("bad", { created_at: "nope", updated_at: today }),
    ];
    const g = grouping({ nodes, links: [] }, "time", NOW);
    expect(g.names).toEqual(["Last 2 weeks", "October 2026", "March 2025"]);
    expect(g.of).toEqual([2, 0, 1, 1, 0]);
  });
});

describe("grouping by links", () => {
  const triangles = () => ({
    nodes: "abcdefghi".split("").map((id) => node(id)),
    links: [
      link("a", "b"),
      link("b", "c"),
      link("a", "c"),
      link("d", "e"),
      link("e", "f"),
      link("d", "f"),
      link("g", "h"),
    ],
  });

  it("finds clusters, small clusters and unlinked items", () => {
    const g = grouping(triangles(), "links", NOW);
    expect(g.names).toEqual(["a", "d", "Small clusters", "Unlinked"]);
    expect(sizes(g)).toEqual([3, 3, 2, 1]);
    expect(g.of.slice(0, 3)).toEqual([0, 0, 0]);
    expect(g.of.slice(3, 6)).toEqual([1, 1, 1]);
    expect(g.of.slice(6, 8)).toEqual([2, 2]);
    expect(g.of[8]).toBe(3);
  });

  it("puts a hub in Hub notes and its leaves in Linked to hubs", () => {
    const nodes = [node("hub"), ...many("leaf", 26)];
    const links = nodes.slice(1).map((n) => link("hub", n.id));
    const g = grouping({ nodes, links }, "links", NOW);
    expect(g.names).toEqual(["Linked to hubs", "Hub notes"]);
    expect(sizes(g)).toEqual([26, 1]);
    expect(g.of[0]).toBe(1);
  });

  it("keeps a note with no link at all apart from a hub's leaves", () => {
    const nodes = [node("hub"), ...many("leaf", 26), node("alone")];
    const links = nodes.slice(1, 27).map((n) => link("hub", n.id));
    const g = grouping({ nodes, links }, "links", NOW);
    expect(g.names).toEqual(["Linked to hubs", "Hub notes", "Unlinked"]);
    expect(sizes(g)).toEqual([26, 1, 1]);
    expect(g.of[27]).toBe(2);
  });

  it("counts a pair linked both ways as one link, so 13 such pairs make no hub", () => {
    const nodes = [node("centre"), ...many("leaf", 13)];
    const links = nodes
      .slice(1)
      .flatMap((n) => [link("centre", n.id), link(n.id, "centre")]);
    expect(links).toHaveLength(26);
    const g = grouping({ nodes, links }, "links", NOW);
    // Degree 13, not 26: one cluster named after the centre, no Hub notes.
    expect(g.names).toEqual(["centre"]);
    expect(sizes(g)).toEqual([14]);
  });

  it("still makes a hub of a centre with 26 distinct neighbours linked both ways", () => {
    const nodes = [node("centre"), ...many("leaf", 26)];
    const links = nodes
      .slice(1)
      .flatMap((n) => [link("centre", n.id), link(n.id, "centre")]);
    const g = grouping({ nodes, links }, "links", NOW);
    expect(g.names).toEqual(["Linked to hubs", "Hub notes"]);
    expect(sizes(g)).toEqual([26, 1]);
  });

  it("does not name a cluster after a member whose title is blank", () => {
    const nodes = [
      node("a", { title: "first" }),
      node("b", { title: "   " }),
      node("c", { title: "third" }),
      node("d", { title: "tail" }),
    ];
    // b has degree 3, the most, but nothing to read.
    const links = [link("a", "b"), link("b", "c"), link("b", "d")];
    expect(grouping({ nodes, links }, "links", NOW).names).toEqual(["first"]);
    const blank = ["a", "b", "c"].map((id) => node(id, { title: " \t" }));
    const tri = [link("a", "b"), link("b", "c"), link("a", "c")];
    expect(grouping({ nodes: blank, links: tri }, "links", NOW).names).toEqual([
      "Cluster 1",
    ]);
  });

  it("names a cluster with no readable member Cluster N", () => {
    const nodes = ["a", "b", "c"].map((id) =>
      node(id, { locked: true, title: null }),
    );
    const links = [link("a", "b"), link("b", "c"), link("a", "c")];
    const g = grouping({ nodes, links }, "links", NOW);
    expect(g.names).toEqual(["Cluster 1"]);
    expect(sizes(g)).toEqual([3]);
  });

  it("names a cluster after its best linked readable member, cut to 28", () => {
    const long = "x".repeat(40);
    const nodes = [
      node("a", { title: "first" }),
      node("b", { title: long }),
      node("c", { title: "third" }),
      node("d", { title: "tail" }),
    ];
    // b has degree 3, the most.
    const links = [link("a", "b"), link("b", "c"), link("b", "d")];
    const g = grouping({ nodes, links }, "links", NOW);
    expect(g.names).toEqual(["x".repeat(28)]);
    expect(sizes(g)).toEqual([4]);
  });

  it("suffixes clusters that share a name", () => {
    const nodes = [
      node("a", { title: "same" }),
      node("b", { title: "same" }),
      node("c", { title: "same" }),
      node("d", { title: "same" }),
      node("e", { title: "same" }),
      node("f", { title: "same" }),
    ];
    const links = [
      link("a", "b"),
      link("b", "c"),
      link("a", "c"),
      link("d", "e"),
      link("e", "f"),
      link("d", "f"),
    ];
    const g = grouping({ nodes, links }, "links", NOW);
    expect(g.names).toEqual(["same", "same (2)"]);
    expect(sizes(g)).toEqual([3, 3]);
  });

  it("ignores a link to an unknown id and a self link", () => {
    const nodes = ["a", "b", "c", "d"].map((id) => node(id));
    const links = [
      link("a", "b"),
      link("b", "c"),
      link("a", "c"),
      link("a", "ghost"),
      link("d", "d"),
    ];
    const g = grouping({ nodes, links }, "links", NOW);
    expect(g.names).toEqual(["a", "Unlinked"]);
    expect(sizes(g)).toEqual([3, 1]);
    expect(g.of[3]).toBe(1);
  });

  it("folds clusters past the cap into Other", () => {
    // 4 triangles with max 3: two clusters stay, two fold.
    const ids = Array.from({ length: 12 }, (_, i) => `n${i}`);
    const nodes = ids.map((id) => node(id));
    const links = [0, 3, 6, 9].flatMap((s) => [
      link(`n${s}`, `n${s + 1}`),
      link(`n${s + 1}`, `n${s + 2}`),
      link(`n${s}`, `n${s + 2}`),
    ]);
    const g = grouping({ nodes, links }, "links", NOW, 3);
    expect(g.names).toEqual(["n0", "n3", "Other"]);
    expect(sizes(g)).toEqual([3, 3, 6]);
  });
});

describe("determinism and edges", () => {
  it("returns the same result twice and ignores link order", () => {
    const nodes = "abcdefghi".split("").map((id) => node(id));
    const links = [
      link("a", "b"),
      link("b", "c"),
      link("a", "c"),
      link("d", "e"),
      link("e", "f"),
      link("d", "f"),
      link("g", "h"),
    ];
    const first = grouping({ nodes, links }, "links", NOW);
    expect(grouping({ nodes, links }, "links", NOW)).toEqual(first);
    const shuffled = grouping(
      { nodes, links: [...links].reverse() },
      "links",
      NOW,
    );
    expect(sizes(shuffled)).toEqual(sizes(first));
    expect(shuffled.names).toEqual(first.names);
    expect(sizes(first)).toEqual([3, 3, 2, 1]);
  });

  it("exposes the filter bar's group labels", () => {
    expect(GROUP_HEADING).toEqual({
      folder: "Folders",
      links: "Clusters",
      time: "Months",
      category: "Categories",
      topic: "Topics",
    });
  });

  it("returns nothing for no nodes", () => {
    for (const a of ["folder", "links", "time", "category", "topic"] as const) {
      expect(grouping({ nodes: [], links: [] }, a, NOW)).toEqual({
        names: [],
        of: [],
      });
    }
  });
});

const T = (id: string, name: string, kind: Kind) => ({ id, name, kind });
const TOPICS = [
  T("c1", "Acme", "client"),
  T("p1", "Qualcomm", "partner"),
  T("v1", "Qualcomm", "vendor"),
  T("s1", "Fleet", "solution"),
  T("v2", "Bolt", "vendor"),
];
const tagged = (id: string, topics: string[], over: Partial<MapNode> = {}) =>
  node(id, { topics, ...over });

describe("the menu order", () => {
  it("lists Folder, Category, Topic, Links, Time", () => {
    expect(ARRANGES.map(([a]) => a)).toEqual([
      "folder",
      "category",
      "topic",
      "links",
      "time",
    ]);
  });
});

describe("grouping by category", () => {
  it("draws kinds in kind order, No topic last, whatever the sizes", () => {
    const nodes = [
      ...Array.from({ length: 5 }, (_, i) => tagged(`n${i}`, [])),
      tagged("a", ["s1"]),
      tagged("b", ["v2"]),
      tagged("c", ["c1"]),
      tagged("d", [], { locked: true, title: null }),
      node("f", { kind: "file", topics: [] }),
    ];
    const g = grouping({ nodes, links: [], topics: TOPICS }, "category", NOW);
    expect(g.names).toEqual(["Customers", "Vendors", "Solutions", "No topic"]);
    expect(g.of).toHaveLength(nodes.length);
    expect(sizes(g)).toEqual([1, 1, 1, 7]);
  });

  it("is decided by the strongest topic that is known", () => {
    const nodes = [
      tagged("a", ["v2", "c1"]),
      tagged("b", ["ghost", "c1"]),
      tagged("c", ["ghost"]),
    ];
    const g = grouping({ nodes, links: [], topics: TOPICS }, "category", NOW);
    expect(g.names).toEqual(["Customers", "Vendors", "No topic"]);
    expect(g.of).toEqual([1, 0, 2]);
  });

  it("puts a locked node and a file under No topic even when their payload carries topic ids", () => {
    const nodes = [
      tagged("a", ["c1"], { locked: true, title: null }),
      tagged("f", ["c1"], { kind: "file" }),
      tagged("b", ["c1"]),
    ];
    const cat = grouping({ nodes, links: [], topics: TOPICS }, "category", NOW);
    expect(cat.names).toEqual(["Customers", "No topic"]);
    expect(cat.of).toEqual([1, 1, 0]);
    const top = grouping({ nodes, links: [], topics: TOPICS }, "topic", NOW);
    expect(top.names).toEqual(["Acme", "No topic"]);
    expect(top.of).toEqual([1, 1, 0]);
  });

  it("puts every node under No topic when the payload has no topics", () => {
    const nodes = [tagged("a", ["c1"]), node("b")];
    const g = grouping({ nodes, links: [] }, "category", NOW);
    expect(g).toEqual({ names: ["No topic"], of: [0, 0] });
  });
});

describe("grouping by topic", () => {
  it("draws the largest first, ties by name, and No topic last whatever its size", () => {
    const nodes = [
      tagged("a", ["v2"]),
      tagged("b", ["c1"]),
      tagged("c", ["c1"]),
      tagged("d", ["s1"]),
      tagged("e", []),
      tagged("f", []),
      tagged("g", []),
    ];
    const g = grouping({ nodes, links: [], topics: TOPICS }, "topic", NOW);
    expect(g.names).toEqual(["Acme", "Bolt", "Fleet", "No topic"]);
    expect(sizes(g)).toEqual([2, 1, 1, 3]);
  });

  it("suffixes a name shared by two kinds, for both, and only then", () => {
    const nodes = [
      tagged("a", ["p1"]),
      tagged("b", ["v1"]),
      tagged("c", ["c1"]),
    ];
    const g = grouping({ nodes, links: [], topics: TOPICS }, "topic", NOW);
    expect(g.names).toEqual([
      "Acme",
      "Qualcomm (Partners)",
      "Qualcomm (Vendors)",
    ]);
    // The shared name appears for one kind only: no suffix.
    const one = grouping(
      { nodes: [tagged("a", ["p1"])], links: [], topics: TOPICS },
      "topic",
      NOW,
    );
    expect(one.names).toEqual(["Qualcomm"]);
  });

  it("folds past the cap into Other topics", () => {
    const topics = Array.from({ length: 14 }, (_, i) =>
      T(`t${i}`, `T${String(i).padStart(2, "0")}`, "subject"),
    );
    const nodes = topics.map((t) => tagged(`n-${t.id}`, [t.id]));
    const g = grouping({ nodes, links: [], topics }, "topic", NOW);
    expect(g.names).toHaveLength(12);
    expect(g.names[11]).toBe("Other topics");
    expect(g.names[0]).toBe("T00");
  });

  it("keeps No topic out of the fold: twelve names, ending Other topics then No topic", () => {
    const topics = Array.from({ length: 15 }, (_, i) =>
      T(`t${i}`, `T${String(i).padStart(2, "0")}`, "subject"),
    );
    const nodes = [
      ...topics.map((t) => tagged(`n-${t.id}`, [t.id])),
      ...Array.from({ length: 40 }, (_, i) => tagged(`none${i}`, [])),
    ];
    const g = grouping({ nodes, links: [], topics }, "topic", NOW);
    expect(g.names).toHaveLength(12);
    expect(g.names.slice(-2)).toEqual(["Other topics", "No topic"]);
    expect(g.names[0]).toBe("T00");
    expect(sizes(g)[11]).toBe(40);
    expect(sizes(g)[10]).toBe(5);
  });

  it("has no No topic group when every node has a topic", () => {
    const nodes = [tagged("a", ["c1"]), tagged("b", ["v2"])];
    const g = grouping({ nodes, links: [], topics: TOPICS }, "topic", NOW);
    expect(g.names).toEqual(["Acme", "Bolt"]);
  });

  it("falls back to No topic for unknown ids and a missing list", () => {
    const nodes = [tagged("a", ["ghost"]), node("b")];
    const g = grouping({ nodes, links: [] }, "topic", NOW);
    expect(g).toEqual({ names: ["No topic"], of: [0, 0] });
  });
});

describe("grouping by topic within one kind", () => {
  const nodes = [
    tagged("a", ["c1", "v1"]),
    tagged("b", ["v1", "c1"]),
    tagged("c", ["v2"]),
    tagged("d", ["s1"]),
    tagged("e", []),
    tagged("f", ["c1"], { locked: true }),
    node("g", { kind: "file", topics: ["c1"] }),
  ];
  const p = {
    nodes,
    links: [
      { from: "a", to: "b", tier: 1, score: 1 },
      { from: "a", to: "d", tier: 1, score: 1 },
    ],
    topics: TOPICS,
  };

  it("counts, per kind in kind order, the readable notes that hold a topic of it", () => {
    expect(topicKinds(p)).toEqual([
      { kind: "client", notes: 2 },
      { kind: "vendor", notes: 3 },
      { kind: "solution", notes: 1 },
    ]);
    expect(topicKinds({ nodes, links: [] })).toEqual([]);
  });

  it("keeps only the notes with a topic of the kind, and the links between them", () => {
    const v = ofKind(p, "vendor");
    expect(v.nodes.map((n) => n.id)).toEqual(["a", "b", "c"]);
    expect(v.links).toEqual([{ from: "a", to: "b", tier: 1, score: 1 }]);
    expect(v.nodes[0]).toBe(nodes[0]);
    expect(ofKind(p, "person").nodes).toEqual([]);
  });

  it("groups each note by its strongest topic of that kind, not its strongest overall", () => {
    const v = ofKind(p, "vendor");
    const g = grouping(v, "topic", NOW, 12, "vendor");
    // a leads with a customer, but under Vendors it sits with its vendor.
    expect(g.names).toEqual(["Qualcomm", "Bolt"]);
    expect(g.of).toEqual([0, 0, 1]);
  });

  it("names the fold for the kind", () => {
    const topics = Array.from({ length: 14 }, (_, i) =>
      T(`x${i}`, `Maker ${String(i).padStart(2, "0")}`, "vendor"),
    );
    const many = topics.flatMap((t, i) =>
      Array.from({ length: 14 - i }, (_, j) => tagged(`${t.id}-${j}`, [t.id])),
    );
    const g = grouping(
      { nodes: many, links: [], topics },
      "topic",
      NOW,
      12,
      "vendor",
    );
    expect(g.names).toHaveLength(12);
    expect(g.names[11]).toBe("Other vendors");
    expect(g.names).not.toContain("No topic");
  });
});
