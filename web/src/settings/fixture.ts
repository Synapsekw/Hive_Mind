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
  SyncKey,
  SyncRun,
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

// One live key on Main, used an hour before the dev page's clock (23 Nov 2026, 12:00 UTC), and
// one revoked on DRA. The runs are newest first; the latest left one file too big and held back
// forty deletions.
const SYNC_KEYS: SyncKey[] = [
  {
    id: "00000000-0000-4000-8000-00000000b001",
    workspaceId: MAIN,
    createdAt: "2026-11-20T09:00:00.000Z",
    lastUsedAt: "2026-11-23T11:00:00.000Z",
    status: "active",
  },
  {
    id: "00000000-0000-4000-8000-00000000b002",
    workspaceId: DRA,
    createdAt: "2026-11-10T09:00:00.000Z",
    lastUsedAt: "2026-11-12T08:00:00.000Z",
    status: "revoked",
  },
];

const SYNC_RUNS: SyncRun[] = [
  {
    id: "00000000-0000-4000-8000-00000000a001",
    keyId: SYNC_KEYS[0]!.id,
    startedAt: "2026-11-23T11:00:00.000Z",
    finishedAt: "2026-11-23T11:00:05.000Z",
    added: 0,
    changed: 0,
    moved: 0,
    deleted: 0,
    skipped: 12,
    tooBig: 1,
    tooBigPaths: ["talks/keynote.key"],
    heldBack: 40,
    error: null,
  },
  {
    id: "00000000-0000-4000-8000-00000000a002",
    keyId: SYNC_KEYS[0]!.id,
    startedAt: "2026-11-23T10:45:00.000Z",
    finishedAt: "2026-11-23T10:46:10.000Z",
    added: 3,
    changed: 1,
    moved: 0,
    deleted: 2,
    skipped: 120,
    tooBig: 1,
    tooBigPaths: ["talks/keynote.key"],
    heldBack: 0,
    error: null,
  },
  {
    id: "00000000-0000-4000-8000-00000000a003",
    keyId: SYNC_KEYS[0]!.id,
    startedAt: "2026-11-22T18:30:00.000Z",
    finishedAt: null,
    added: 0,
    changed: 0,
    moved: 0,
    deleted: 0,
    skipped: 0,
    tooBig: 0,
    tooBigPaths: [],
    heldBack: 0,
    error: "offline",
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

/** With `many`: thirty vendors beside the two sample topics, so a kind starts folded. */
const MANY_TOPICS: TopicRow[] = Array.from({ length: 30 }, (_, i) => ({
  id: `00000000-0000-4000-8000-0000000b${String(i).padStart(4, "0")}`,
  kind: "vendor" as const,
  name: `Supplier ${i + 1}`,
  notes: i,
}));

/**
 * With `many`, forty vendors the hive does not have. Otherwise the heads the dev page's scan
 * answers: one new customer, one known, a partner named like the
 * saved customer, a solution, a tag on five notes.
 */
export function fixtureHeads(many = false): NoteHead[] {
  if (many)
    return Array.from({ length: 40 }, (_, i) => ({
      path: `Knowledge/Vendors/Maker ${i + 1}.md`,
      title: `Maker ${i + 1}`,
      type: "vendor",
      aliases: [],
      tags: [],
    }));
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
  opts: { member?: boolean; none?: boolean; many?: boolean } = {},
): SettingsData {
  const me = opts.member ? AHMED : DANIJEL;
  return {
    hiveName: "Synapse",
    isOwner: !opts.member,
    workspaces: WORKSPACES.map((w) => ({ ...w })),
    agents: opts.none ? [] : AGENTS.map((a) => ({ ...a })),
    members: MEMBERS.map((m) => ({ ...m, isMe: m.id === me })),
    invitations: opts.member ? [] : INVITATIONS.map((i) => ({ ...i })),
    syncKeys: opts.none ? [] : SYNC_KEYS.map((k) => ({ ...k })),
    syncRuns: opts.none
      ? []
      : SYNC_RUNS.map((r) => ({ ...r, tooBigPaths: [...r.tooBigPaths] })),
    topics: opts.member
      ? []
      : [...TOPICS, ...(opts.many ? MANY_TOPICS : [])].map((x) => ({ ...x })),
  };
}

/** What deleting the sample hive would erase. */
export function fixtureDeletion(): Deletion {
  return { members: MEMBERS.length, notes: 128, files: 14 };
}

/** When the sample hive is erased, in the view where it is being deleted. */
export const FIXTURE_DELETE_AFTER = "2026-11-30T12:00:00.000Z";
