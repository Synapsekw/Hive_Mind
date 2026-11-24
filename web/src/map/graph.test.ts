import { describe, expect, it } from "vitest";
import { activity, agentStatus, BOX, buildModel } from "./graph";
import { grouping } from "./arrange";
import { fixturePayload } from "./fixture";
import type { MapNode, MapPayload } from "./types";

const NOW = Date.UTC(2026, 10, 22, 12, 0, 0);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const iso = (t: number) => new Date(t).toISOString();

const ME = { id: "m-me", display_name: "Danijel", is_me: true };
const AHMED = { id: "m-ahmed", display_name: "Ahmed", is_me: false };

function note(
  id: string,
  topic: string,
  extra: Partial<MapNode> = {},
): MapNode {
  return {
    id,
    kind: "note",
    topic,
    member_id: ME.id,
    updated_at: iso(NOW - 3 * DAY),
    locked: false,
    title: `Title ${id}`,
    path: `${topic}/${id}.md`,
    workspace_id: "w1",
    by_agent: false,
    agent_id: null,
    note_id: null,
    ...extra,
  };
}

function payload(
  nodes: MapNode[],
  extra: Partial<MapPayload> = {},
): MapPayload {
  return {
    members: [ME, AHMED],
    agents: [],
    nodes,
    links: [],
    truncated: false,
    ...extra,
  };
}

/** `counts[i]` notes in topic `T<i>`. */
function topicsPayload(counts: number[]): MapPayload {
  const nodes: MapNode[] = [];
  counts.forEach((c, i) => {
    for (let j = 0; j < c; j++) nodes.push(note(`t${i}-${j}`, `T${i}`));
  });
  return payload(nodes);
}

const LOCKED_NOTE: MapNode = {
  ...note("locked-1", "Kestrel"),
  member_id: AHMED.id,
  locked: true,
  title: null,
  path: null,
  workspace_id: null,
  by_agent: null,
};

describe("BOX", () => {
  it("is 1000 x 760", () => {
    expect(BOX).toEqual({ w: 1000, h: 760 });
  });
});

describe("buildModel", () => {
  it("folds 10 topics into 8, the last named Other, counts summing to the item count", () => {
    const counts = [30, 25, 20, 18, 15, 12, 10, 8, 5, 3];
    const m = buildModel(topicsPayload(counts));
    expect(m.topics).toHaveLength(8);
    expect(m.topics[7]!.name).toBe("Other");
    expect(m.topics[7]!.hue).toBe(7);
    expect(m.topics[7]!.count).toBe(8 + 5 + 3);
    expect(m.topics.map((t) => t.hue)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    const items = m.nodes.filter((n) => n.kind === "note" || n.kind === "file");
    expect(m.topics.reduce((s, t) => s + t.count, 0)).toBe(items.length);
    expect(items.length).toBe(counts.reduce((s, c) => s + c, 0));
  });

  it("ranks topics by item count, ties by name", () => {
    const m = buildModel(
      payload([
        note("a", "Beta"),
        note("b", "Alpha"),
        note("c", "Gamma"),
        note("d", "Gamma"),
      ]),
    );
    expect(m.topics.map((t) => t.name)).toEqual(["Gamma", "Alpha", "Beta"]);
  });

  it("keeps 3 topics as 3, each with its own hue", () => {
    const m = buildModel(topicsPayload([4, 2, 1]));
    expect(m.topics).toHaveLength(3);
    expect(m.topics.map((t) => t.name)).toEqual(["T0", "T1", "T2"]);
    expect(m.topics.map((t) => t.hue)).toEqual([0, 1, 2]);
    expect(m.topics.some((t) => t.name === "Other")).toBe(false);
  });

  it("builds one hub per time group, in order, and files each item under its group", () => {
    const p = payload([
      note("a", "X", { updated_at: iso(NOW - 2 * DAY) }),
      note("b", "X", { updated_at: iso(NOW - 40 * DAY) }),
      note("c", "Y", { updated_at: iso(NOW - 41 * DAY) }),
      note("d", "Y", { updated_at: iso(NOW - 80 * DAY) }),
    ]);
    const g = grouping(p, "time", NOW);
    const m = buildModel(p, g);
    expect(m.topics.map((t) => t.name)).toEqual(g.names);
    expect(m.nodes.filter((n) => n.kind === "hub")).toHaveLength(
      g.names.length,
    );
    const items = m.nodes.filter((n) => n.kind === "note");
    items.forEach((n, i) => expect(n.topic).toBe(g.of[i]));
    expect(m.topics.reduce((s, t) => s + t.count, 0)).toBe(items.length);
  });

  it("gives 12 groups the hues 0 to 7 then 0 to 3", () => {
    const counts = [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
    const p = topicsPayload(counts);
    const m = buildModel(p, grouping(p, "folder", NOW));
    expect(m.topics).toHaveLength(12);
    expect(m.topics.map((t) => t.hue)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 0, 1, 2, 3,
    ]);
  });

  it("orders nodes root, hubs, items, agents", () => {
    const m = buildModel(
      payload([note("n1", "A"), note("n2", "B")], {
        agents: [
          {
            id: "ag1",
            member_id: ME.id,
            provider: "Claude desktop",
            trust_tier: "vendor",
            last_used_at: null,
            name: "laptop",
          },
          {
            id: "ag2",
            member_id: AHMED.id,
            provider: "Ollama",
            trust_tier: "self_hosted",
            last_used_at: null,
            name: null,
          },
        ],
      }),
    );
    expect(m.nodes.map((n) => n.kind)).toEqual([
      "root",
      "hub",
      "hub",
      "note",
      "note",
      "agent",
      "agent",
    ]);
    m.nodes.forEach((n, i) => expect(n.i).toBe(i));
    expect(m.nodes[0]).toMatchObject({
      id: null,
      title: "Hive index",
      topic: -1,
    });
    expect(m.nodes[1]).toMatchObject({
      id: null,
      title: "A",
      mine: false,
      locked: false,
    });
    expect(m.nodes[5]).toMatchObject({
      id: "ag1",
      topic: -1,
      member: ME.id,
      mine: true,
      title: "Danijel, Claude desktop",
    });
    expect(m.nodes[6]!.title).toBe("Ahmed, Ollama, self-hosted");
  });

  it("shows a locked note as Private note and a locked file as Private file", () => {
    const leaky: MapNode = {
      ...LOCKED_NOTE,
      title: "Secret pricing",
      path: "x/secret.md",
    };
    const lockedFile: MapNode = {
      ...LOCKED_NOTE,
      id: "locked-f",
      kind: "file",
      title: "Secret deck.pptx",
    };
    const m = buildModel(payload([leaky, lockedFile]));
    const n = m.nodes.find((x) => x.id === "locked-1")!;
    const f = m.nodes.find((x) => x.id === "locked-f")!;
    expect(n.title).toBe("Private note");
    expect(n.path).toBeNull();
    expect(n.locked).toBe(true);
    expect(f.title).toBe("Private file");
    expect(f.path).toBeNull();
    expect(JSON.stringify(m)).not.toContain("Secret");
  });

  it("hangs a file with a readable note off that note, not the hub", () => {
    const n = note("n1", "A");
    const f: MapNode = { ...note("f1", "A"), kind: "file", note_id: "n1" };
    const m = buildModel(payload([n, f]));
    const hub = m.nodes.findIndex((x) => x.kind === "hub");
    const ni = m.nodes.findIndex((x) => x.id === "n1");
    const fi = m.nodes.findIndex((x) => x.id === "f1");
    expect(m.nodes[fi]!.nb).toContain(ni);
    expect(m.nodes[fi]!.nb).not.toContain(hub);
    expect(m.nodes[ni]!.nb).toContain(fi);
  });

  it("hangs a file off the hub when its note is locked or absent", () => {
    const f1: MapNode = {
      ...note("f1", "Kestrel"),
      kind: "file",
      note_id: "locked-1",
    };
    const f2: MapNode = {
      ...note("f2", "Kestrel"),
      kind: "file",
      note_id: "missing",
    };
    const m = buildModel(payload([LOCKED_NOTE, f1, f2]));
    const hub = m.nodes.findIndex((x) => x.kind === "hub");
    for (const id of ["f1", "f2"]) {
      const node = m.nodes.find((x) => x.id === id)!;
      expect(node.nb).toEqual([hub]);
    }
  });

  it("adds real links, ignoring links whose end is not in the model", () => {
    const m = buildModel(
      payload([note("n1", "A"), note("n2", "B")], {
        links: [
          { from: "n1", to: "n2", tier: 1, score: 0.9 },
          { from: "n1", to: "ghost", tier: 1, score: 0.9 },
        ],
      }),
    );
    expect(m.linkCount).toBe(1);
    const a = m.nodes.findIndex((x) => x.id === "n1");
    const b = m.nodes.findIndex((x) => x.id === "n2");
    expect(m.edges).toContainEqual([a, b]);
    expect(m.nodes[a]!.nb).toContain(b);
  });

  it("counts a link only when it adds an edge", () => {
    const f: MapNode = { ...note("f1", "A"), kind: "file", note_id: "n1" };
    const m = buildModel(
      payload([note("n1", "A"), note("n2", "B"), f], {
        links: [
          { from: "n1", to: "n2", tier: 1, score: 0.9 },
          { from: "n2", to: "n1", tier: 1, score: 0.9 },
          { from: "n1", to: "n2", tier: 2, score: 0.5 },
          // The same as the structural note-to-file edge.
          { from: "f1", to: "n1", tier: 1, score: 0.9 },
        ],
      }),
    );
    expect(m.linkCount).toBe(1);
  });

  it("names the folded topic Other topics when a real topic is called Other", () => {
    const counts = [30, 25, 20, 18, 15, 12, 10, 8, 5, 3];
    const p = topicsPayload(counts);
    for (const n of p.nodes) if (n.topic === "T2") n.topic = "Other";
    const m = buildModel(p);
    const names = m.topics.map((t) => t.name);
    expect(names).toHaveLength(8);
    expect(new Set(names).size).toBe(8);
    expect(names).toContain("Other");
    expect(names[7]).toBe("Other topics");
  });

  it("connects own agents to hubs by agent_id and a colleague's agent by by_agent notes", () => {
    const mine = note("n1", "A", { by_agent: true, agent_id: "ag-me" });
    const plain = note("n2", "B");
    const theirs = note("n3", "C", { member_id: AHMED.id, by_agent: true });
    const m = buildModel(
      payload([mine, plain, theirs], {
        agents: [
          {
            id: "ag-me",
            member_id: ME.id,
            provider: "ChatGPT",
            trust_tier: "vendor",
            last_used_at: null,
            name: null,
          },
          {
            id: "ag-ahmed",
            member_id: AHMED.id,
            provider: "Codex CLI",
            trust_tier: "vendor",
            last_used_at: null,
            name: null,
          },
        ],
      }),
    );
    const hubOf = (name: string) =>
      m.nodes.findIndex((x) => x.kind === "hub" && x.title === name);
    const me = m.nodes.find((x) => x.id === "ag-me")!;
    const ahmed = m.nodes.find((x) => x.id === "ag-ahmed")!;
    expect(me.nb).toEqual([hubOf("A")]);
    expect(ahmed.nb).toEqual([hubOf("C")]);
  });

  it("keeps an item whose member is not in members", () => {
    const m = buildModel(payload([note("n1", "A", { member_id: "stranger" })]));
    const n = m.nodes.find((x) => x.id === "n1")!;
    expect(n.member).toBe("stranger");
    expect(n.mine).toBe(false);
    expect(() => activity(m, NOW)).not.toThrow();
  });

  it("gives an empty payload a model with only the root", () => {
    const m = buildModel(payload([], { members: [] }));
    expect(m.nodes).toHaveLength(1);
    expect(m.nodes[0]!.kind).toBe("root");
    expect(m.topics).toEqual([]);
    expect(m.edges).toEqual([]);
    expect(m.linkCount).toBe(0);
  });

  it("builds the fixture without leaking a locked title", () => {
    const p = fixturePayload(NOW);
    const m = buildModel(p);
    expect(p.nodes.length).toBeGreaterThan(250);
    expect(p.members).toHaveLength(3);
    expect(p.agents).toHaveLength(4);
    expect(new Set(p.nodes.map((n) => n.topic)).size).toBe(10);
    expect(p.nodes.some((n) => n.locked)).toBe(true);
    expect(p.nodes.some((n) => n.kind === "file")).toBe(true);
    expect(p.links.length).toBeGreaterThan(0);
    for (const n of m.nodes) {
      if (n.locked) expect(["Private note", "Private file"]).toContain(n.title);
    }
    expect(fixturePayload(NOW)).toEqual(p);
  });
});

describe("agentStatus", () => {
  it("says connected within 70 minutes", () => {
    expect(agentStatus(iso(NOW - 10 * 60_000), NOW)).toBe("connected");
  });
  it("says the last-used day otherwise", () => {
    expect(agentStatus(iso(NOW - 3 * DAY), NOW)).toBe("last used 19 Nov");
  });
  it("says never used for null", () => {
    expect(agentStatus(null, NOW)).toBe("never used");
  });
});

describe("activity", () => {
  it("counts nodes changed in the last 24 hours, locked included", () => {
    const m = buildModel(
      payload([
        note("n1", "A", { updated_at: iso(NOW - HOUR) }),
        { ...LOCKED_NOTE, updated_at: iso(NOW - 2 * HOUR) },
        note("n3", "A", { updated_at: iso(NOW - 2 * DAY) }),
      ]),
    );
    const a = activity(m, NOW);
    expect(a.today).toBe(2);
    expect(a.perMember[0]).toMatchObject({ count: 1 });
    expect(a.perMember.map((p) => p.count)).toEqual([1, 1]);
  });

  it("groups agent writes by member and day over the last 14 days", () => {
    const m = buildModel(
      payload([
        note("n1", "A", { by_agent: true, updated_at: iso(NOW - HOUR) }),
        note("n2", "A", { by_agent: true, updated_at: iso(NOW - 2 * HOUR) }),
        note("n3", "A", { by_agent: true, updated_at: iso(NOW - 30 * DAY) }),
        note("n4", "A", { by_agent: false, updated_at: iso(NOW - HOUR) }),
      ]),
    );
    const a = activity(m, NOW);
    expect(a.days).toEqual([{ day: 13, member: ME.id, count: 2 }]);
  });
});
