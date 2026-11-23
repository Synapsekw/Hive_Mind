// Shapes shared by the inbox screen, its loader and its actions. The database decides what a
// person may see of a colleague's note; these only carry what it returned: the owner's name, the
// topic and, when the person may already read the note, its title. Never its body, path or id.
export type Tier = 1 | 2 | 3 | 4;

export type LinkItem = {
  id: string;
  tier: Tier;
  /** ISO timestamp of the proposal. */
  createdAt: string;
  /** Whose side proposed it: the person's own agent, or the colleague's side. */
  proposedBy: "mine" | "theirs";
  /** True when the other side has already accepted. */
  theyAccepted: boolean;
  mine: { id: string; title: string; path: string; workspaceId: string };
  /** `title` is null unless the person may already read the note. */
  theirs: { memberName: string; topic: string; title: string | null };
};

export type HeldItem = {
  id: string;
  title: string;
  path: string;
  workspaceId: string;
  agentName: string | null;
  /** ISO timestamp of the last write. */
  updatedAt: string;
};

export type InboxData = {
  links: LinkItem[];
  linksTotal: number;
  held: HeldItem[];
  heldTotal: number;
};

export type Result = { ok: boolean };

export type InboxActions = {
  respondToLink(id: string, accept: boolean): Promise<Result>;
  releaseNote(id: string): Promise<Result>;
};
