// A deterministic sample hive for the dev page and the tests: about 300 items across 10 topics,
// 3 members, 4 agents, files, links and locked nodes. Dates are relative to `now`: everything was
// written and last changed within the last 14 days, so the Timeline shows days. With `old` the
// items were written over the last 1,000 days (and last changed as before), so it shows quarters.
import type { MapNode, MapPayload } from "./types";

const TOPICS: [string, number][] = [
  ["DMT", 52],
  ["ADNOC", 44],
  ["Tower inspections", 38],
  ["Airspace approvals", 36],
  ["ITC proposal", 34],
  ["Kestrel AI", 30],
  ["Quadruped fleet", 24],
  ["Emsteel", 18],
  ["Hiring", 14],
  ["Ops handbook", 10],
];
const NOTE_TITLES = [
  "Overview",
  "Pricing basis",
  "Rate card",
  "Kickoff minutes",
  "Site visit",
  "Access log",
  "Scope",
  "Stakeholders",
  "Risks",
  "Timeline",
  "Review comments",
  "Method statement",
  "Checklist",
  "Budget notes",
  "Contacts",
  "Open questions",
  "Lessons learned",
  "Permit tracker",
  "Handover notes",
  "Meeting notes",
];
const FILE_TITLES = [
  "Proposal.docx",
  "Deck.pptx",
  "Rate card.xlsx",
  "Survey.pdf",
  "Photos.pdf",
  "Report.pdf",
];

const ME = "00000000-0000-4000-8000-000000000001";
const AHMED = "00000000-0000-4000-8000-000000000002";
const SARA = "00000000-0000-4000-8000-000000000003";
const AGENT_CLAUDE = "00000000-0000-4000-8000-0000000000a1";
const AGENT_CHATGPT = "00000000-0000-4000-8000-0000000000a2";
const AGENT_AHMED = "00000000-0000-4000-8000-0000000000a3";
const AGENT_SARA = "00000000-0000-4000-8000-0000000000a4";

const MIN = 60_000;
const DAY = 86_400_000;

/** A hostile title (300 characters) the browser test uses to prove titles render as text. */
export const HOSTILE_TITLE = (
  "<img src=x onerror=alert(1)> " +
  "a title written by someone else that runs far longer than a line, ".repeat(5)
).slice(0, 300);

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-");

export function fixturePayload(
  now: number,
  opts: { items?: number; old?: boolean } = {},
): MapPayload {
  let seed = 7;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const iso = (t: number) => new Date(t).toISOString();

  const nodes: MapNode[] = [];
  const readableByTopic: string[][] = TOPICS.map(() => []);
  // Without `items` one pass over the tables (about 300 items). With it, further passes add the
  // same tables with suffixed titles ("Overview · 2") until that many items exist.
  const want = opts.items !== undefined ? Math.max(0, opts.items - 1) : null;
  for (let round = 0; ; round++) {
    if (want !== null && nodes.length >= want) break;
    if (want === null && round > 0) break;
    const suffix = round > 0 ? ` · ${round + 1}` : "";
    TOPICS.forEach(([topic, count], ti) => {
      const readable = readableByTopic[ti]!;
      let lastNote: string | null = null;
      for (let j = 0; j < count; j++) {
        if (want !== null && nodes.length >= want) return;
        const file = j % 4 === 3;
        const x = rnd();
        const member = x < 0.5 ? ME : x < 0.8 ? AHMED : SARA;
        const locked = member !== ME && rnd() < 0.35;
        const list = file ? FILE_TITLES : NOTE_TITLES;
        const c = file ? Math.floor(j / 4) : j - Math.floor(j / 4);
        const title =
          list[c % list.length]! +
          (c >= list.length ? ` ${Math.floor(c / list.length) + 1}` : "") +
          suffix;
        const byAgent = rnd() < 0.6;
        const id = `00000000-0000-4000-9000-${String(round * 100_000 + ti * 1000 + j).padStart(12, "0")}`;
        // Most changes are recent; the tail is held at 13 days so the sample fits 14 day columns.
        const updated =
          now - Math.min(13 * DAY, Math.floor(Math.pow(rnd(), 2.2) * 20 * DAY));
        // Written when last changed, or with `old` up to 1,000 days before that. No random
        // number is drawn for it, so everything else is the same sample either way.
        const back = ((round * 17 + ti * 37 + j * 101) % 211) / 210;
        const created = opts.old
          ? updated - Math.floor(back * 1000 * DAY)
          : updated;
        const path = `${topic}/${slug(title)}${file ? "" : ".md"}`;
        nodes.push({
          id,
          kind: file ? "file" : "note",
          topic,
          member_id: member,
          updated_at: iso(updated),
          created_at: iso(created),
          locked,
          title: locked ? null : title,
          path: locked ? null : path,
          workspace_id: locked ? null : `ws-${member.slice(-1)}`,
          by_agent: locked ? null : byAgent,
          agent_id:
            !locked && member === ME && byAgent && !file
              ? rnd() < 0.6
                ? AGENT_CLAUDE
                : AGENT_CHATGPT
              : null,
          note_id: !locked && file ? lastNote : null,
        });
        if (!locked) {
          readable.push(id);
          if (!file) lastNote = id;
        }
      }
    });
  }
  const rounds = Math.max(1, Math.ceil(nodes.length / 300));

  // Not added to `readableByTopic`, so the links below are the same as without it.
  nodes.push({
    id: "00000000-0000-4000-9000-999999999999",
    kind: "note",
    topic: "Ops handbook",
    member_id: ME,
    updated_at: iso(now - 2 * 60 * MIN),
    created_at: iso(now - 2 * 60 * MIN),
    locked: false,
    title: HOSTILE_TITLE,
    path: "Ops handbook/hostile-title.md",
    workspace_id: "ws-1",
    by_agent: true,
    agent_id: AGENT_CLAUDE,
    note_id: null,
  });

  const links: MapPayload["links"] = [];
  for (let k = 0; k < 40 * rounds; k++) {
    const a = readableByTopic[Math.floor(rnd() * TOPICS.length)]!;
    const b = readableByTopic[Math.floor(rnd() * TOPICS.length)]!;
    const from = a[Math.floor(rnd() * a.length)];
    const to = b[Math.floor(rnd() * b.length)];
    if (from && to && from !== to) {
      links.push({
        from,
        to,
        tier: 1 + Math.floor(rnd() * 3),
        score: Math.round(rnd() * 100) / 100,
      });
    }
  }

  return {
    members: [
      { id: ME, display_name: "Danijel", is_me: true },
      { id: AHMED, display_name: "Ahmed", is_me: false },
      { id: SARA, display_name: "Sara", is_me: false },
    ],
    agents: [
      {
        id: AGENT_CLAUDE,
        member_id: ME,
        provider: "Claude desktop",
        trust_tier: "vendor",
        last_used_at: iso(now - 10 * MIN),
        name: "Laptop",
      },
      {
        id: AGENT_CHATGPT,
        member_id: ME,
        provider: "ChatGPT",
        trust_tier: "vendor",
        last_used_at: iso(now - 3 * DAY),
        name: null,
      },
      {
        id: AGENT_AHMED,
        member_id: AHMED,
        provider: "Codex CLI",
        trust_tier: "vendor",
        last_used_at: iso(now - 2 * 60 * MIN),
        name: null,
      },
      {
        id: AGENT_SARA,
        member_id: SARA,
        provider: "Ollama",
        trust_tier: "self_hosted",
        last_used_at: null,
        name: null,
      },
    ],
    nodes,
    links,
    truncated: false,
  };
}
