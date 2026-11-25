import { describe, expect, it } from "vitest";
import { topicTree } from "./topicTree";
import type { VaultNote, VaultTopic } from "./types";

function note(id: string, topics: string[]): VaultNote {
  return {
    id,
    workspace_id: "w1",
    member_id: "m1",
    path: `${id}.md`,
    title: id,
    updated_at: "2026-11-01T00:00:00.000Z",
    by_agent: false,
    visibility: null,
    shared_with: [],
    quarantined: false,
    effective: "private",
    effective_with: [],
    rule_folder: null,
    access: "own",
    topics,
  };
}
const topic = (id: string, kind: VaultTopic["kind"], name: string) => ({
  id,
  kind,
  name,
});
const TOPICS = [
  topic("v1", "vendor", "Survey Kit Co"),
  topic("c2", "client", "Northfield Foods"),
  topic("c1", "client", "Harbor Logistics"),
  topic("s1", "subject", "Pricing"),
  topic("c3", "client", "Unused Ltd"),
];

describe("topicTree", () => {
  it("lists kinds in kind order and topics by name", () => {
    const t = topicTree(
      [note("a", ["s1", "v1", "c2", "c1"])],
      [TOPICS[3]!, TOPICS[0]!, TOPICS[1]!, TOPICS[2]!],
    );
    expect(t.kinds.map((k) => k.kind)).toEqual(["client", "vendor", "subject"]);
    expect(t.kinds[0]!.topics.map((x) => x.name)).toEqual([
      "Harbor Logistics",
      "Northfield Foods",
    ]);
    expect(t.kinds[0]!.name).toBe("Customers");
  });

  it("counts a topic's notes at any position, not only the strongest", () => {
    const t = topicTree([note("a", ["c1", "s1"]), note("b", ["s1"])], TOPICS);
    const subject = t.kinds.find((k) => k.kind === "subject")!;
    expect(subject.topics).toEqual([{ id: "s1", name: "Pricing", count: 2 }]);
  });

  it("counts a kind's distinct notes, once each", () => {
    const t = topicTree(
      [note("a", ["c1", "c2"]), note("b", ["c1"]), note("c", ["s1"])],
      TOPICS,
    );
    const client = t.kinds.find((k) => k.kind === "client")!;
    expect(client.count).toBe(2);
    expect(client.topics.map((x) => x.count)).toEqual([2, 1]);
  });

  it("counts the notes with no topic", () => {
    expect(
      topicTree([note("a", []), note("b", ["c1"]), note("c", [])], TOPICS).none,
    ).toBe(2);
  });

  it("leaves out topics and kinds with no note in this tab", () => {
    const t = topicTree([note("a", ["c1"])], TOPICS);
    expect(t.kinds.map((k) => k.kind)).toEqual(["client"]);
    expect(t.kinds[0]!.topics.map((x) => x.id)).toEqual(["c1"]);
  });

  it("ignores a topic id the hive's list does not have", () => {
    const t = topicTree(
      [note("a", ["gone"]), note("b", ["gone", "c1"])],
      TOPICS,
    );
    expect(t.kinds.map((k) => k.kind)).toEqual(["client"]);
    expect(t.kinds[0]!.count).toBe(1);
    // A note whose topics are all unknown still carries topics: it is not "none".
    expect(t.none).toBe(0);
  });

  it("is empty for no notes", () => {
    expect(topicTree([], TOPICS)).toEqual({ kinds: [], none: 0 });
  });
});
