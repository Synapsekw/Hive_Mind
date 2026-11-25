// A deterministic sample vault for the dev page and the tests: one hive of three people, two
// workspaces of about 60 notes in nested folders, two folder rules, notes with their own setting,
// two held notes and five notes shared by colleagues. Two accepted links: "Findings draft" with
// Sara's "Pricing options" (the note opened by a link) and with my own "Call notes". Dates are
// relative to `now`; nothing random.
//
// For the notes `me` owns, `effective`, `effective_with`, `rule_folder` and `access` are worked
// out here from the folder rules the way the database would report them (nearest ancestor rule
// wins, a note's own setting beats it, no rule and no setting = private), so a test can assert
// exact counts. `rule_folder` is the nearest rule folder even when the note has its own setting.
import type {
  FolderRule,
  NoteLink,
  SharePreview,
  VaultData,
  VaultNote,
  VaultTopic,
  Visibility,
} from "./types";

const HOUR = 3_600_000;

const ME = "00000000-0000-4000-8000-000000000001";
const AHMED = "00000000-0000-4000-8000-000000000002";
const SARA = "00000000-0000-4000-8000-000000000003";
const W_CONSULTING = "00000000-0000-4000-8000-000000000b01";
const W_OPERATIONS = "00000000-0000-4000-8000-000000000b02";
const W_AHMED = "00000000-0000-4000-8000-000000000b03";
const W_SARA = "00000000-0000-4000-8000-000000000b04";

/** The folder that carries the `group` rule, with notes of every kind beneath it. */
export const GROUP_FOLDER = "clients";

export const HOSTILE_BODY = [
  "# Vendor call",
  "",
  "Notes from the call with the equipment vendor.",
  "",
  "## Quote",
  "",
  "| Item | Price |",
  "| ---- | ----- |",
  "| Survey kit | 4,200 |",
  "| Training day | 900 |",
  "",
  "## Follow-ups",
  "",
  "- Ask for a revised delivery date",
  "- Confirm the warranty terms",
  "",
  "See the [vendor site](https://example.com/vendor) for the data sheet.",
  "",
  "<script>alert(1)</script>",
  "",
  "<img src=x onerror=alert(1)>",
  "",
  "[click](javascript:alert(1))",
  "",
  "![pixel](https://example.invalid/pixel.png)",
  "",
  "[![badge](https://example.invalid/badge.png)](https://example.com/project)",
  "",
].join("\n");

type Own = {
  v?: Visibility;
  w?: string[];
  held?: boolean;
  agent?: boolean;
};
// [workspace, path, title, own setting]
const MINE: [string, string, string, Own?][] = [
  // Consulting: clients (group rule), clients/harbor-logistics (members rule)
  [W_CONSULTING, "clients/client-list.md", "Client list"],
  [W_CONSULTING, "clients/onboarding-checklist.md", "Onboarding checklist"],
  [W_CONSULTING, "clients/harbor-logistics/kickoff-notes.md", "Kickoff notes"],
  [
    W_CONSULTING,
    "clients/harbor-logistics/scope-and-assumptions.md",
    "Scope and assumptions",
  ],
  [
    W_CONSULTING,
    "clients/harbor-logistics/interview-summary-1.md",
    "Interview summary 1",
  ],
  [
    W_CONSULTING,
    "clients/harbor-logistics/interview-summary-2.md",
    "Interview summary 2",
  ],
  [W_CONSULTING, "clients/harbor-logistics/risk-register.md", "Risk register"],
  [
    W_CONSULTING,
    "clients/harbor-logistics/invoice-schedule.md",
    "Invoice schedule",
    { v: "private" },
  ],
  [W_CONSULTING, "clients/northfield-foods/brief.md", "Brief"],
  [
    W_CONSULTING,
    "clients/northfield-foods/stakeholder-map.md",
    "Stakeholder map",
  ],
  [
    W_CONSULTING,
    "clients/northfield-foods/workshop-notes.md",
    "Workshop notes",
  ],
  [
    W_CONSULTING,
    "clients/northfield-foods/open-questions.md",
    "Open questions",
  ],
  [
    W_CONSULTING,
    "clients/northfield-foods/status-update-march.md",
    "Status update, March",
  ],
  [
    W_CONSULTING,
    "clients/northfield-foods/status-update-april.md",
    "Status update, April",
    { v: "group" },
  ],
  [
    W_CONSULTING,
    "clients/northfield-foods/workshop-transcript-raw.md",
    "Workshop transcript, raw",
    { held: true, agent: true },
  ],
  [W_CONSULTING, "clients/redwood-energy/brief.md", "Brief"],
  [W_CONSULTING, "clients/redwood-energy/data-request.md", "Data request"],
  [W_CONSULTING, "clients/redwood-energy/call-notes.md", "Call notes"],
  [
    W_CONSULTING,
    "clients/redwood-energy/findings-draft.md",
    "Findings draft",
    { v: "private" },
  ],
  [
    W_CONSULTING,
    "clients/redwood-energy/call-recording-raw.md",
    "Call recording, raw",
    { held: true, agent: true },
  ],
  // Consulting: decisions, sessions, research, templates, root
  [
    W_CONSULTING,
    "decisions/2026-03-weekly-reviews.md",
    "Decision: weekly reviews",
  ],
  [
    W_CONSULTING,
    "decisions/2026-04-fixed-fee-proposals.md",
    "Decision: fixed-fee proposals",
  ],
  [
    W_CONSULTING,
    "decisions/2026-06-shared-calendar.md",
    "Decision: shared calendar",
    { v: "group" },
  ],
  [
    W_CONSULTING,
    "decisions/2026-08-travel-policy.md",
    "Decision: travel policy",
  ],
  [
    W_CONSULTING,
    "decisions/2026-10-invoice-terms.md",
    "Decision: invoice terms",
  ],
  [
    W_CONSULTING,
    "sessions/2026-11-03-planning.md",
    "Planning session",
    { agent: true },
  ],
  [
    W_CONSULTING,
    "sessions/2026-11-05-proposal-review.md",
    "Proposal review",
    { agent: true },
  ],
  [
    W_CONSULTING,
    "sessions/2026-11-09-client-prep.md",
    "Client prep",
    { v: "members", w: [AHMED] },
  ],
  [W_CONSULTING, "sessions/2026-11-12-vendor-call.md", "Vendor call notes"],
  [W_CONSULTING, "sessions/2026-11-16-retro.md", "Retro"],
  [
    W_CONSULTING,
    "sessions/2026-11-19-pipeline-review.md",
    "Pipeline review",
    { agent: true },
  ],
  [W_CONSULTING, "research/market-sizing.md", "Market sizing"],
  [W_CONSULTING, "research/competitor-notes.md", "Competitor notes"],
  [W_CONSULTING, "research/interview-guide.md", "Interview guide"],
  [W_CONSULTING, "research/reading-list.md", "Reading list"],
  [W_CONSULTING, "research/survey-draft.md", "Survey draft"],
  [W_CONSULTING, "research/tooling-comparison.md", "Tooling comparison"],
  [W_CONSULTING, "templates/engagement-letter.md", "Engagement letter"],
  [W_CONSULTING, "templates/proposal-outline.md", "Proposal outline"],
  [W_CONSULTING, "templates/status-update.md", "Status update template"],
  [W_CONSULTING, "readme.md", "Readme"],
  [W_CONSULTING, "glossary.md", "Glossary"],
  // Operations
  [W_OPERATIONS, "handbook/working-hours.md", "Working hours"],
  [W_OPERATIONS, "handbook/expenses.md", "Expenses"],
  [W_OPERATIONS, "handbook/security-basics.md", "Security basics"],
  [W_OPERATIONS, "handbook/holiday-cover.md", "Holiday cover"],
  [W_OPERATIONS, "handbook/tools-and-accounts.md", "Tools and accounts"],
  [W_OPERATIONS, "handbook/onboarding.md", "Onboarding for new members"],
  [W_OPERATIONS, "finance/monthly-close.md", "Monthly close"],
  [W_OPERATIONS, "finance/budget-2027.md", "Budget 2027", { v: "private" }],
  [W_OPERATIONS, "finance/vat-notes.md", "VAT notes"],
  [W_OPERATIONS, "finance/supplier-payments.md", "Supplier payments"],
  [
    W_OPERATIONS,
    "finance/rate-card.md",
    "Rate card",
    { v: "members", w: [AHMED, SARA] },
  ],
  [W_OPERATIONS, "finance/expense-claims.md", "Expense claims"],
  [W_OPERATIONS, "hiring/role-outline.md", "Role outline"],
  [W_OPERATIONS, "hiring/interview-questions.md", "Interview questions"],
  [W_OPERATIONS, "hiring/candidate-log.md", "Candidate log", { v: "private" }],
  [W_OPERATIONS, "hiring/offer-template.md", "Offer template"],
  [W_OPERATIONS, "admin/office-lease.md", "Office lease"],
  [W_OPERATIONS, "admin/insurance.md", "Insurance"],
  [W_OPERATIONS, "admin/equipment-list.md", "Equipment list"],
  [W_OPERATIONS, "admin/renewals.md", "Renewals"],
];

// Colleagues' notes shared with me: [owner, workspace, path, title, visibility, with, access]
const SHARED: [
  string,
  string,
  string,
  string,
  Visibility,
  string[],
  "shared" | "link",
][] = [
  [
    AHMED,
    W_AHMED,
    "clients/harbor-logistics/site-visit.md",
    "Site visit",
    "group",
    [],
    "shared",
  ],
  [
    AHMED,
    W_AHMED,
    "decisions/2026-09-reporting-format.md",
    "Decision: reporting format",
    "group",
    [],
    "shared",
  ],
  [
    AHMED,
    W_AHMED,
    "research/regulation-summary.md",
    "Regulation summary",
    "group",
    [],
    "shared",
  ],
  [
    SARA,
    W_SARA,
    "clients/northfield-foods/interview-notes.md",
    "Interview notes",
    "members",
    [ME, AHMED],
    "shared",
  ],
  [
    SARA,
    W_SARA,
    "clients/redwood-energy/pricing-options.md",
    "Pricing options",
    "members",
    [AHMED],
    "link",
  ],
];

const RULES: Record<string, FolderRule[]> = {
  [W_CONSULTING]: [
    { path: "archive", visibility: null, shared_with: [] },
    { path: GROUP_FOLDER, visibility: "group", shared_with: [] },
    {
      path: "clients/harbor-logistics",
      visibility: "members",
      shared_with: [AHMED],
    },
  ],
  [W_OPERATIONS]: [{ path: "hiring", visibility: null, shared_with: [] }],
};

// Accepted links, newest first: [link id, one note's path, the other note's path].
const LINKS: [string, string, string][] = [
  [
    "00000000-0000-4000-8000-000000000c01",
    "clients/redwood-energy/findings-draft.md",
    "clients/redwood-energy/pricing-options.md",
  ],
  [
    "00000000-0000-4000-8000-000000000c02",
    "clients/redwood-energy/findings-draft.md",
    "clients/redwood-energy/call-notes.md",
  ],
];

const topicId = (n: number) =>
  `00000000-0000-4000-8000-${(0xd0001 + n).toString(16).padStart(12, "0")}`;
const T_HARBOR = topicId(0);
const T_NORTHFIELD = topicId(1);
const T_PARTNER = topicId(2);
const T_VENDOR = topicId(3);
const T_SOLUTION = topicId(4);
const T_SUBJECT = topicId(5);

/** The hive's topics: two customers, a partner, a vendor, a solution and a subject. */
const TOPICS: VaultTopic[] = [
  { id: T_HARBOR, kind: "client", name: "Harbor Logistics" },
  { id: T_NORTHFIELD, kind: "client", name: "Northfield Foods" },
  { id: T_PARTNER, kind: "partner", name: "Bluewater Partners" },
  { id: T_VENDOR, kind: "vendor", name: "Survey Kit Co" },
  { id: T_SOLUTION, kind: "solution", name: "Route optimisation" },
  { id: T_SUBJECT, kind: "subject", name: "Pricing" },
];

// The topics of some notes by path, strongest first; a note not listed has none.
const NOTE_TOPICS: Record<string, string[]> = {
  "clients/harbor-logistics/kickoff-notes.md": [T_HARBOR],
  "clients/harbor-logistics/scope-and-assumptions.md": [
    T_HARBOR,
    T_SOLUTION,
    T_SUBJECT,
    T_PARTNER,
    T_VENDOR,
  ],
  "clients/harbor-logistics/interview-summary-1.md": [T_HARBOR, T_SOLUTION],
  "clients/northfield-foods/brief.md": [T_NORTHFIELD],
  "clients/northfield-foods/workshop-notes.md": [T_NORTHFIELD, T_SUBJECT],
  "sessions/2026-11-12-vendor-call.md": [T_VENDOR, T_SUBJECT],
  "research/competitor-notes.md": [T_PARTNER],
  "finance/rate-card.md": [T_SUBJECT],
  // Colleagues' notes
  "clients/harbor-logistics/site-visit.md": [T_HARBOR],
  "clients/redwood-energy/pricing-options.md": [T_SUBJECT],
};

const MEMBERS = [
  { id: ME, display_name: "Danijel" },
  { id: AHMED, display_name: "Ahmed" },
  { id: SARA, display_name: "Sara" },
];

/** A note's accepted links as the database lists them: the note on the other side of each. */
function linksOf(note: VaultNote, pool: VaultNote[]): NoteLink[] {
  const out: NoteLink[] = [];
  for (const [id, a, b] of LINKS) {
    if (note.path !== a && note.path !== b) continue;
    const other = pool.find((n) => n.path === (note.path === a ? b : a));
    if (!other) continue;
    out.push({
      id,
      note_id: other.id,
      title: other.title,
      owner: MEMBERS.find((m) => m.id === other.member_id)?.display_name ?? "",
      mine: other.member_id === ME,
    });
  }
  return out;
}

/** Nearest ancestor folder record with a visibility. */
function nearestRule(folders: FolderRule[], path: string): FolderRule | null {
  let best: FolderRule | null = null;
  for (const f of folders) {
    if (f.visibility === null || !path.startsWith(`${f.path}/`)) continue;
    if (!best || f.path.length > best.path.length) best = f;
  }
  return best;
}

const noteId = (i: number) =>
  `00000000-0000-4000-8000-${(0x10001 + i).toString(16).padStart(12, "0")}`;

/** The note whose body is `HOSTILE_BODY`. */
export const HOSTILE_NOTE_ID = noteId(
  MINE.findIndex(([, path]) => path === "sessions/2026-11-12-vendor-call.md"),
);

function allNotes(now: number): VaultNote[] {
  const out: VaultNote[] = [];
  const stamp = (i: number) => new Date(now - (i * 7 + 3) * HOUR).toISOString();
  MINE.forEach(([workspace_id, path, title, own = {}], i) => {
    const ruled = nearestRule(RULES[workspace_id] ?? [], path);
    const visibility = own.v ?? null;
    const effective: Visibility = visibility ?? ruled?.visibility ?? "private";
    const shared_with = visibility === "members" ? (own.w ?? []) : [];
    const effective_with =
      effective === "members"
        ? visibility === "members"
          ? shared_with
          : ruled!.shared_with
        : [];
    out.push({
      id: noteId(i),
      workspace_id,
      member_id: ME,
      path,
      title,
      updated_at: stamp(i),
      by_agent: own.agent ?? false,
      visibility,
      shared_with,
      quarantined: own.held ?? false,
      effective,
      effective_with,
      rule_folder: ruled?.path ?? null,
      access: "own",
      topics: [...(NOTE_TOPICS[path] ?? [])],
    });
  });
  SHARED.forEach(([member_id, workspace_id, path, title, v, w, access], k) => {
    const i = MINE.length + k;
    out.push({
      id: noteId(i),
      workspace_id,
      member_id,
      path,
      title,
      updated_at: stamp(i),
      by_agent: false,
      visibility: v,
      shared_with: w,
      quarantined: false,
      effective: v,
      effective_with: w,
      rule_folder: null,
      access,
      topics: [...(NOTE_TOPICS[path] ?? [])],
    });
  });
  return out;
}

export function fixtureVault(
  now: number,
  query: { ws?: string; tab?: string; note?: string } = {},
): VaultData {
  const workspaces = [
    { id: W_CONSULTING, name: "Consulting" },
    { id: W_OPERATIONS, name: "Operations" },
  ];
  const pool = allNotes(now);
  const isShared = query.tab === "shared";
  const ws = workspaces.find((w) => w.id === query.ws) ?? workspaces[0]!;
  const notes = isShared
    ? pool.filter((n) => n.member_id !== ME)
    : pool.filter((n) => n.member_id === ME && n.workspace_id === ws.id);

  let open: VaultData["open"] = null;
  if (query.note !== undefined) {
    const found = pool.find((n) => n.id === query.note);
    open = found
      ? {
          note: found,
          body:
            found.id === HOSTILE_NOTE_ID
              ? HOSTILE_BODY
              : `# ${found.title}\n\nSample note.\n`,
          cut: false,
          links: linksOf(found, pool),
        }
      : { missing: true };
  }
  return {
    hive: { id: "00000000-0000-4000-8000-000000000a01", name: "Synapse" },
    me: ME,
    members: MEMBERS.map((m) => ({ ...m })),
    workspaces,
    tab: isShared ? { kind: "shared" } : { kind: "workspace", id: ws.id },
    folders: isShared ? [] : (RULES[ws.id] ?? []),
    notes,
    truncated: false,
    topics: TOPICS.map((t) => ({ ...t })),
    open,
  };
}

/** The four counts the database reports for a folder, derived from the data's own notes. */
export function fixturePreview(data: VaultData, path: string): SharePreview {
  const inside = data.notes.filter(
    (n) => path === "" || n.path.startsWith(`${path}/`),
  );
  const nested = data.folders.filter(
    (f) =>
      f.visibility !== null && f.path.startsWith(`${path}/`) && f.path !== path,
  );
  const p: SharePreview = {
    follows: 0,
    own_setting: 0,
    under_nested_rule: 0,
    held: 0,
  };
  for (const n of inside) {
    if (n.visibility !== null) p.own_setting++;
    else if (nested.some((f) => n.path.startsWith(`${f.path}/`)))
      p.under_nested_rule++;
    else {
      p.follows++;
      if (n.quarantined) p.held++;
    }
  }
  return p;
}
