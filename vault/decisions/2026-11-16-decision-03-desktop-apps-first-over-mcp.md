---
type: adr
date: 2026-11-16
status: accepted
tags: [decision]
related: []
---

# Decision 03 — The desktop apps are the workspace; the platform plugs in over MCP

## Context

Members must not pay API usage for ordinary work. A chat UI of our own cannot run on a consumer Claude or ChatGPT subscription except through the vendors' official sign-in programmes, which need approval and bill against a side allowance.

## Decision

People keep working in Claude and ChatGPT. The platform is an MCP connector enabled in one dedicated project per member. The web app is a control tower (map, inbox, sharing), not a chat. Hosted chat comes last and only through "Sign in with Claude" and "Sign in with ChatGPT". Token-proxy approaches are out.

## Rationale

The MCP path needs no approval and costs nothing in inference. Researched 2026-11-16: both vendors prohibit unofficial use of subscription tokens in third-party apps.

## Consequences

- Positive: zero inference cost; works with any MCP agent.
- Negative: sync depends on the project instructions the agent follows; the custom-connector route needs a public HTTPS address, so it arrives with hosting.
- Open follow-ups: apply to both vendor programmes before phase 6.
