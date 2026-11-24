import { describe, expect, it } from "vitest";
import * as t from "./topicsText";

describe("the sentences of the Topics section", () => {
  it("names each kind in the plural", () => {
    expect(t.KIND_NAMES).toEqual({
      client: "Customers",
      project: "Projects",
      vendor: "Vendors",
      product: "Products",
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
});
