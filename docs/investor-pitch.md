---
type: report
status: draft
last-updated: 2026-11-21
tags: [project/hive-mind, pitch]
---

# Investor Pitch — Shared Mind for Expert Teams

Working name: Hive (final brand under review). Draft for pre-seed conversations. Market and
competitor figures are as researched on 2026-11-16 and must be re-checked before external use.

## 1. The one-liner

A private shared mind for small expert teams: every member's AI agent keeps its own memory, the
platform links those memories into one consented, provenance-backed knowledge graph, and the
team's agents start answering like a single senior expert.

## 2. The problem

Every professional now has an AI agent, and every agent starts from zero. Memory features in Claude
and ChatGPT are personal and locked to one vendor. Team knowledge still lives in people's heads,
chat threads and folders. When a colleague leaves, their context leaves with them.

Developer memory layers solve storage for agents built by engineers. None gives a team of experts
a product: ownership per person, consent before sharing, provenance on every fact, and the
documents the agents produce.

## 3. The product

- Each member connects their own Claude, ChatGPT or any MCP agent in five minutes, from the apps
  they already use, on the subscription they already pay for.
- Their agent writes memory and saves deliverables into a private space. Nothing is shared until
  the member says so, per folder or per note.
- The platform discovers overlap between members, proposes a link, and both sides accept before
  anything moves.
- A synthesis page per client or project consolidates everyone's shared notes into one current
  view, every fact citing its author.
- A map shows the whole mind: one dot per note, six views of the same graph.
- A housekeeper agent keeps links, entities and synthesis pages healthy, proposing but never
  deciding.
- A gallery holds every deck, document and spreadsheet the agents produced.

## 4. Why now

- MCP has become the common connector protocol across Claude, ChatGPT, coding agents and
  open-source agents, so one integration reaches every agent.
- Both Anthropic and OpenAI launched official programmes in 2026 that let approved third-party
  apps run on a user's existing plan.
- Teams are moving from one assistant per person to many agents, with no answer for shared,
  governed memory.

## 5. Who it is for

Small expert teams, five to fifty people, whose value is specialised knowledge of clients, assets
and regulations: consultancies, bid teams, engineering practices, specialist sales teams. The
founder's own practice is the first hive and the design partner.

## 6. Named competitors

Shared memory across Claude and ChatGPT for a team already exists in several forms. Investors will
find these in minutes, so the pitch names them.

| Company            | What they offer                                                                  | Pricing signal (Nov 2026)             | Where we differ                                                          |
| ------------------ | -------------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------ |
| Basic Memory Teams | One shared markdown knowledge base for a team and every agent; all writes shared | Credit-metered team tiers; SSO add-on | Everything-shared vs private-by-default with double-accept; no synthesis |
| Mnemoverse         | One memory pool across accounts, membership checked per call                     | Free, Pro, Team, Enterprise           | Developer API first; no consent handshake or provenance synthesis        |
| TeamShared         | Graph with curator pages, file library, memory explorer, email invites           | Not published in sources reviewed     | Built for agent swarms and engineers; no expert-team product             |
| Supermemory        | Hosted memory API with shared spaces; remote MCP                                 | Free credits; Pro $19/month           | Developer product; sharing by configuration                              |
| Mem0               | Memory layer for AI apps                                                         | Starter $19/month; Pro $249/month     | Infrastructure for builders                                              |
| Zep                | Shared graph memory across agents, bound to identity                             | Flex $125/month                       | Engineering teams; no human sharing workflow                             |
| Cognee, Letta      | Open-source memory engines with multi-user modes                                 | Free self-hosted; paid cloud          | Need engineering to run                                                  |

**The gap:** all of these are shared stores. None combines personal ownership, a consent handshake
before sharing, weighted links between people's knowledge, provenance-backed synthesis, a
housekeeper, deliverables alongside memory, and zero inference cost for members.

## 7. Market opportunity (GCC, approximate)

Target: knowledge-intensive SMEs of 15 to 100 people across the six GCC states. These are founder
estimates to verify against Monsha'at (Saudi Arabia) and UAE Ministry of Economy statistics.

| Step                          | Estimate                                       |
| ----------------------------- | ---------------------------------------------- |
| Registered SMEs in the GCC    | roughly 3 million, mostly micro businesses     |
| Firms with 15 to 100 staff    | 5 to 10 percent: 150,000 to 300,000            |
| Knowledge-intensive share     | about one fifth: 30,000 to 60,000 firms        |
| Average hive                  | 25 members at $20 a month: about $6,000 a year |
| Serviceable market            | $180 million to $360 million a year            |
| Five-year target at 1 percent | 300 to 600 paying hives; $2 to $4 million ARR  |

Pricing position: above developer memory tools ($19 to $20 a month per individual) and far below
enterprise knowledge platforms; $15 to $40 per member per month, with a free tier up to three
members.

## 8. Business model

- Per-member subscription, billed per hive, with a free tier for up to three members.
- Tiers by member count and features: hosted chat, SSO, data residency, audit export.
- Low cost of goods: inference runs on members' own plans; platform API spend is limited to
  background housekeeping and capped per hive.

## 9. Go to market

- Founder-led: the first hive is the founder's own practice; the next five come from the founder's
  network of consultancies and bid teams in the GCC.
- Product-led: an invited member who connects in five minutes starts their own hive at their next
  company.
- Partnerships: connector directory listings once the sign-in programmes are approved.

## 10. Technology

Supabase (Postgres, row-level security, Storage, Auth), an MCP server, Next.js. Security by
structure: visibility enforced in the database; no agent tool can change sharing, members or
tokens; layered guardrails against prompt injection; break-glass-only operator access.

## 11. Team

- Founder: fifteen years operating drones and robotics across the GCC, founder of three
  businesses, builds his own AI tooling and runs a single-person version of this product today.
- Hiring: a founding engineer (TypeScript, Postgres) and a product designer.

## 12. The ask

- Pre-seed round to fund twelve months: two engineers, one designer, infrastructure, and vendor
  programme approvals.
- Milestones: first hive in daily use within two months, five paying hives within nine, hosted
  chat approved by both vendors within twelve.

## 13. Risks and answers

- **Vendors add team memory natively:** they will stay single-vendor; our value is cross-agent,
  consented and provenance-backed.
- **Developer memory layers move up-market:** they sell to engineers; we sell a finished product
  to experts.
- **Vendor programme approval delays:** the MCP path works with no approval; hosted chat is
  additive.
- **Trust:** private by default, human-controlled sharing and structural security are the product,
  not a feature.
