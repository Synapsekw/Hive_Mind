import { describe, expect, it } from "vitest";
import { fixtureSettings } from "./fixture";
import { tabCount, tabFromParam, tabsFor } from "./tabs";

describe("tabs", () => {
  it("an owner sees five tabs, a member three", () => {
    expect(tabsFor(true)).toEqual([
      "agents",
      "workspaces",
      "topics",
      "people",
      "hive",
    ]);
    expect(tabsFor(false)).toEqual(["agents", "workspaces", "people"]);
  });
  it.each(["agents", "workspaces", "topics", "people", "hive"])(
    "?tab=%s opens it for an owner",
    (t) => {
      expect(tabFromParam(t, true)).toBe(t);
    },
  );
  it.each([[null], [undefined], [""], ["nope"], ["AGENTS"]])(
    "%s opens Agents",
    (v) => {
      expect(tabFromParam(v as string | null, true)).toBe("agents");
    },
  );
  it("a member asking for topics or hive gets Agents", () => {
    expect(tabFromParam("topics", false)).toBe("agents");
    expect(tabFromParam("hive", false)).toBe("agents");
    expect(tabFromParam("people", false)).toBe("people");
  });
  it("counts active agents, workspaces, topics and people with invitations; none for Hive", () => {
    const d = fixtureSettings({});
    const active = d.agents.filter((a) => a.status === "active").length;
    expect(tabCount("agents", d, 0)).toBe(active);
    expect(tabCount("workspaces", d, 0)).toBe(d.workspaces.length);
    expect(tabCount("topics", d, 0)).toBe(d.topics.length);
    expect(tabCount("people", d, 2)).toBe(d.members.length + 2);
    expect(tabCount("hive", d, 0)).toBeNull();
  });
});
