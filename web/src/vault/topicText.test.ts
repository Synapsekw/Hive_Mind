import { describe, expect, it } from "vitest";
import * as t from "./topicText";

describe("the sentences of browsing and changing topics", () => {
  it("names the switch and its two buttons", () => {
    expect(t.SWITCH).toBe("Browse notes by");
    expect(t.BY_FOLDERS).toBe("Folders");
    expect(t.BY_TOPICS).toBe("Topics");
  });

  it("names the two ends of the topic list", () => {
    expect(t.ALL_NOTES).toBe("All notes");
    expect(t.NO_TOPIC).toBe("No topic");
  });

  it("words the open note's section", () => {
    expect(t.TOPICS_HEADING).toBe("Topics");
    expect(t.ADD_TOPIC).toBe("Add topic");
    expect(t.ADD_TOPIC_BUTTON).toBe("+ Topic");
    expect(t.FIND_TOPIC).toBe("Find a topic");
    expect(t.NO_TOPIC_MATCHES).toBe("No topic matches.");
  });

  it("names each remove button by its topic", () => {
    expect(t.removeName("Harbor Logistics")).toBe("Remove Harbor Logistics");
  });

  it("says what was changed, for the status line", () => {
    expect(t.removed("Harbor Logistics")).toBe(
      "Removed from Harbor Logistics.",
    );
    expect(t.added("Pricing")).toBe("Added to Pricing.");
  });

  it("says why a change was refused", () => {
    expect(t.REFUSED_FULL).toBe(
      "A note has at most five topics. Remove one first.",
    );
    expect(t.REFUSED).toBe("That didn't work. Try again.");
  });
});
