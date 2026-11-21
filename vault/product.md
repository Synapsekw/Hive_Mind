---
type: product-context
status: active
last-updated: 2026-11-21
tags: [project/hive-mind, product, design-context]
related:
  - "[[00-north-star]]"
---

# Product

## What it is

**Hive Mind** (working name) — a private shared memory for small expert teams. Each member's AI
agent writes into that member's own space; the platform links people's notes with consent and
keeps a synthesis page per topic. Full requirements: [[prd]].

## Users

- **Members (primary)** — domain experts who already work in Claude or ChatGPT all day. They do not
  want another app to live in; they want their agent to remember, and to know what colleagues know.
- **Owner** — invites people, sets defaults, keeps the topic registry clean.
- **Agents** — the heaviest users by volume. They read and write; they never decide sharing.
- **Super admin** — runs the service across hives, without reading member content.

First cohort: the founder's own practice, then consultancies and bid teams of 5 to 50 people.

## Why it exists

Every agent starts from zero and vendor memory is personal and single-vendor. A team's knowledge
of its clients walks out the door with each person. The goal is a hive that accumulates enough
specific domain knowledge that the team's agents behave like one senior expert.

## What makes it different

Competitors (Basic Memory Teams, Mnemoverse, Supermemory, Mem0, Zep) are shared stores. This is
personal ownership plus a consent handshake, weighted links between people's knowledge,
provenance-backed synthesis, a housekeeper, deliverables next to memory, and zero inference cost
for members. Detail and pricing signals: [[investor-pitch]].

## Design principles

- **Trust is the product.** Private by default; nothing moves without a person's click.
- **Humans decide, the system suggests.** Suggestions are quiet inbox items, never blocking modals.
- **One idea per screen.** The map is a map; the chat is a chat.
- **Light is information.** Bright = yours and recent; hollow = not shared with you.
- **Show, don't store.** The web app is a view of the database and holds no state of its own.
- **Familiar where it must be.** People keep working in the apps they already use.

## Brand personality

Quiet, precise, modern, minimal. Dark-first. No decoration that does not carry meaning. Tokens and
the map's six views: [[ui-concept]]. Chosen map design:
[[2026-11-20-decision-07-brain-dashboard-is-the-map]].

## Anti-references

- A chat app that competes with Claude or ChatGPT.
- A team wiki people must maintain by hand.
- An everything-shared pool where a private note can surface in a colleague's answer.
- A dashboard of widgets.
