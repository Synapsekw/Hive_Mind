// The Settings tabs: which a person sees, which a `?tab=` value opens, and the number beside
// each name. Client state only: choosing a tab asks the server for nothing.
import type { SettingsData } from "./types";

export type Tab = "agents" | "workspaces" | "topics" | "people" | "hive";

export const TAB_NAMES: Record<Tab, string> = {
  agents: "Agents",
  workspaces: "Workspaces",
  topics: "Topics",
  people: "People",
  hive: "Hive",
};

/** The tabs a person sees: a member has no Topics and no Hive. */
export function tabsFor(isOwner: boolean): Tab[] {
  return isOwner
    ? ["agents", "workspaces", "topics", "people", "hive"]
    : ["agents", "workspaces", "people"];
}

/** The tab a `?tab=` value opens; anything not shown to this person opens Agents. */
export function tabFromParam(
  v: string | null | undefined,
  isOwner: boolean,
): Tab {
  return (tabsFor(isOwner) as string[]).includes(v ?? "")
    ? (v as Tab)
    : "agents";
}

/** The number beside a tab's name; null for Hive. */
export function tabCount(
  tab: Tab,
  d: SettingsData,
  invitations: number,
): number | null {
  switch (tab) {
    case "agents":
      return d.agents.filter((a) => a.status === "active").length;
    case "workspaces":
      return d.workspaces.length;
    case "topics":
      return d.topics.length;
    case "people":
      return d.members.length + invitations;
    case "hive":
      return null;
  }
}
