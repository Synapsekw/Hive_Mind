import { describe, expect, it } from "vitest";
import * as t from "./topicsText";

describe("the sentences of the Topics section", () => {
  it("names each kind in the plural", () => {
    expect(t.KIND_NAMES).toEqual({
      client: "Customers",
      partner: "Partners",
      project: "Projects",
      vendor: "Vendors",
      product: "Products",
      solution: "Solutions",
      person: "People",
      subject: "Subjects",
    });
  });

  it("says how many notes a topic and a candidate have", () => {
    expect(t.topicNotes(0)).toBe("No notes yet");
    expect(t.topicNotes(1)).toBe("1 note");
    expect(t.topicNotes(12)).toBe("12 notes");
    expect(t.topicNotes(null)).toBeNull();
    expect(t.candidateNotes("subject", 7)).toBe("tag on 7 notes");
    expect(t.candidateNotes("client", 1)).toBeNull();
  });

  it("lists a candidate's other names, or nothing", () => {
    expect(t.alsoKnown(["Orbit Aerospace"])).toBe("also: Orbit Aerospace");
    expect(t.alsoKnown(["A", "B", "C"])).toBe("also: A, B, C");
    expect(t.alsoKnown([])).toBeNull();
  });

  it("puts the other names in a candidate's checkbox name, after the old format", () => {
    expect(t.pickLabel("Customers", "Orbit")).toBe("Customers: Orbit");
    expect(t.pickLabel("Customers", "Orbit", ["Orbit Aerospace", "OA"])).toBe(
      "Customers: Orbit, also: Orbit Aerospace, OA",
    );
  });

  it("says which kinds a candidate is already saved under", () => {
    expect(t.alreadyUnder(["Customers"])).toBe("already under Customers");
    expect(t.alreadyUnder(["Customers", "Vendors"])).toBe(
      "already under Customers and Vendors",
    );
    expect(t.alreadyUnder(["Customers", "Vendors", "Products"])).toBe(
      "already under Customers, Vendors and Products",
    );
  });

  it("adds those words to a candidate's checkbox name, after the old format", () => {
    expect(
      t.pickLabel("Partners", "Zain", [], t.alreadyUnder(["Customers"])),
    ).toBe("Partners: Zain, already under Customers");
    expect(
      t.pickLabel("Partners", "Zain", ["Z"], t.alreadyUnder(["Customers"])),
    ).toBe("Partners: Zain, also: Z, already under Customers");
  });

  it("tells the owner who will see a topic's names", () => {
    expect(t.FOUND_NOTE).toMatch(
      /Tick the ones this hive should have\. Every member of the hive can see a topic's name and its other names\.$/,
    );
  });

  it("says what a save did", () => {
    expect(t.saved(0)).toBe("Those topics were already there.");
    expect(t.saved(1)).toBe("1 topic saved.");
    expect(t.saved(40)).toBe("40 topics saved.");
  });

  it("asks before deleting, and says what goes with the topic", () => {
    expect(t.deleteQuestion("Zain")).toBe("Delete the topic Zain?");
    expect(t.DELETE_ASIDE).toBe(
      "Notes stay. They are no longer under this topic.",
    );
  });

  it("says how many candidates are ticked, and names the tick-all buttons by kind", () => {
    expect(t.ticked(3, 40)).toBe("3 of 40 ticked");
    expect(t.tickAll("Vendors")).toBe("Tick all Vendors");
    expect(t.tickNone("Vendors")).toBe("Untick all Vendors");
  });
});
