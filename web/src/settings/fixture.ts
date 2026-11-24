// Deterministic sample settings for the dev page and the tests: the hive Synapse with two
// workspaces, three agents, three members and two pending invitations. The edges the screen has to
// show are all there: an agent used recently, a self-hosted one never used, a revoked one, and the
// owner's and a plain member's view. Ids and timestamps are fixed; nothing is random and nothing
// reads the clock.
import type {
  Agent,
  Deletion,
  Invitation,
  Member,
  NoteHead,
  SettingsData,
  TopicRow,
  Workspace,
} from "./types";

const MAIN = "00000000-0000-4000-8000-0000000000e1";
const DRA = "00000000-0000-4000-8000-0000000000e2";

const WORKSPACES: Workspace[] = [
  { id: MAIN, name: "Main", notes: 128 },
  { id: DRA, name: "DRA", notes: 25 },
];

const AGENTS: Agent[] = [
  {
    id: "00000000-0000-4000-8000-00000000d001",
    name: "Claude Code",
    provider: "Claude Code",
    trustTier: "vendor",
    workspaceId: MAIN,
    createdAt: "2026-11-18T10:15:00.000Z",
    lastUsedAt: "2026-11-23T08:30:00.000Z",
    status: "active",
  },
  {
    id: "00000000-0000-4000-8000-00000000d002",
    name: "Local model",
    provider: "Other",
    trustTier: "self_hosted",
    workspaceId: DRA,
    createdAt: "2026-11-21T14:00:00.000Z",
    lastUsedAt: null,
    status: "active",
  },
  {
    id: "00000000-0000-4000-8000-00000000d003",
    name: "Old laptop",
    provider: "Claude",
    trustTier: "vendor",
    workspaceId: MAIN,
    createdAt: "2026-10-02T09:00:00.000Z",
    lastUsedAt: "2026-10-30T17:45:00.000Z",
    status: "revoked",
  },
];

const DANIJEL = "00000000-0000-4000-8000-00000000f001";
const AHMED = "00000000-0000-4000-8000-00000000f002";
const SARA = "00000000-0000-4000-8000-00000000f003";

const MEMBERS: Omit<Member, "isMe">[] = [
  { id: DANIJEL, name: "Danijel", role: "owner" },
  { id: AHMED, name: "Ahmed", role: "member" },
  { id: SARA, name: "Sara", role: "member" },
];

// Newest first, each open for fourteen days, as the loader hands them over.
const INVITATIONS: Invitation[] = [
  {
    id: "00000000-0000-4000-8000-00000000c001",
    email: "lena@example.com",
    name: "Lena",
    createdAt: "2026-11-22T16:00:00.000Z",
    expiresAt: "2026-12-06T16:00:00.000Z",
  },
  {
    id: "00000000-0000-4000-8000-00000000c002",
    email: "marko@example.com",
    name: "Marko",
    createdAt: "2026-11-20T09:30:00.000Z",
    expiresAt: "2026-12-04T09:30:00.000Z",
  },
];

const TOPICS: TopicRow[] = [
  {
    id: "00000000-0000-4000-8000-0000000000a1",
    kind: "client",
    name: "Zain",
    notes: 198,
  },
  {
    id: "00000000-0000-4000-8000-0000000000a2",
    kind: "vendor",
    name: "Terra Drone",
    notes: 0,
  },
];

/**
 * The heads the dev page's scan answers: one new customer, one known, a partner named like the
 * saved customer, a solution, a tag on five notes.
 */
export function fixtureHeads(): NoteHead[] {
  const tagged = Array.from({ length: 5 }, (_, i) => ({
    path: `Sessions/s${i}.md`,
    title: `Session ${i}`,
    type: "session",
    aliases: [],
    tags: ["flare-stack"],
  }));
  return [
    {
      path: "Employers/Orbit/_Index.md",
      title: "Orbit Aerospace",
      type: "client-entity",
      aliases: [],
      tags: [],
    },
    {
      path: "Employers/Zain/_Index.md",
      title: "Zain",
      type: "client-entity",
      aliases: [],
      tags: [],
    },
    {
      path: "Employers/Zain/Partners/Zain.md",
      title: "Zain",
      type: "partner-entity",
      aliases: [],
      tags: [],
    },
    {
      path: "Knowledge/Categories/Underwater ROVs.md",
      title: "Underwater ROVs",
      type: "category",
      aliases: [],
      tags: [],
    },
    ...tagged,
  ];
}

/**
 * The sample settings, as the owner Danijel sees them. `member` is Ahmed's view: not the owner,
 * the "you" mark on Ahmed, and no invitations, which only the owner can read. `none` has no
 * agents yet.
 */
export function fixtureSettings(
  opts: { member?: boolean; none?: boolean } = {},
): SettingsData {
  const me = opts.member ? AHMED : DANIJEL;
  return {
    hiveName: "Synapse",
    isOwner: !opts.member,
    workspaces: WORKSPACES.map((w) => ({ ...w })),
    agents: opts.none ? [] : AGENTS.map((a) => ({ ...a })),
    members: MEMBERS.map((m) => ({ ...m, isMe: m.id === me })),
    invitations: opts.member ? [] : INVITATIONS.map((i) => ({ ...i })),
    topics: opts.member ? [] : TOPICS.map((x) => ({ ...x })),
  };
}

/** What deleting the sample hive would erase. */
export function fixtureDeletion(): Deletion {
  return { members: MEMBERS.length, notes: 128, files: 14 };
}

/** When the sample hive is erased, in the view where it is being deleted. */
export const FIXTURE_DELETE_AFTER = "2026-11-30T12:00:00.000Z";
