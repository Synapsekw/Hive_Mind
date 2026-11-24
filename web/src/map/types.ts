// The `map_graph` payload (see docs/superpowers/plans/2026-11-22-web-map.md, "The payload
// contract") and the drawing model the map is built from.

export type MapPayload = {
  members: { id: string; display_name: string; is_me: boolean }[];
  agents: {
    id: string;
    member_id: string;
    provider: string;
    trust_tier: "vendor" | "self_hosted";
    last_used_at: string | null;
    name: string | null; // only the caller's own agents
  }[];
  nodes: MapNode[];
  links: { from: string; to: string; tier: number; score: number }[];
  truncated: boolean;
};

export type MapNode = {
  id: string;
  kind: "note" | "file";
  topic: string;
  member_id: string;
  updated_at: string;
  locked: boolean;
  // null on a locked node:
  title: string | null;
  path: string | null;
  workspace_id: string | null;
  by_agent: boolean | null;
  // only on the caller's own notes:
  agent_id: string | null;
  // only on a readable file:
  note_id: string | null;
};

export type View = "rings" | "timeline" | "orbit";
export type NodeKind = "root" | "hub" | "note" | "file" | "agent";

export type ModelNode = {
  i: number; // index in MapModel.nodes; root is 0
  id: string | null; // database id; null for root and hubs
  kind: NodeKind;
  topic: number; // index into MapModel.topics; -1 for root and agents
  member: string | null;
  mine: boolean;
  locked: boolean;
  title: string; // "Private note" / "Private file" when locked
  path: string | null;
  updatedAt: number; // epoch ms; 0 for root and hubs
  byAgent: boolean;
  nb: number[]; // neighbours
};

export type MapModel = {
  topics: { name: string; hue: number; count: number }[]; // hue 0..7
  members: { id: string; name: string; isMe: boolean }[];
  nodes: ModelNode[];
  edges: [number, number][]; // structural edges and real links
  linkCount: number; // real links only
  truncated: boolean;
};

export type Filter = {
  topic: number | null;
  kind: NodeKind | null;
  member: string | null;
  q: string;
  sel: number | null;
  /**
   * Does the search also match an item's group name? Default true. False where a group name is
   * not a word the user filed by (in Rings, a cluster named after a note, or a month).
   */
  groupNames?: boolean;
};

export type Activity = {
  today: number;
  perMember: { id: string; name: string; count: number }[]; // most first
  days: { day: number; member: string; count: number }[]; // agent writes, last 14 days
};
