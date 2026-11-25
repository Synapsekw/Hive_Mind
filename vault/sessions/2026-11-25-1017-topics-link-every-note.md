---
type: session
date: 2026-11-25-1017
branch: develop
trigger: wrapup
status: complete
tags: [session]
related: []
---

# Topics: every note hangs off a customer, vendor or subject

## What changed

- **Topics, part 1** (`20261124173204_topics.sql`): Settings finds topics in the owner's notes and saves them; the vault's "Attach topics" puts each note under up to five. Spec `docs/superpowers/specs/2026-11-24-topics-design.md`.
- **Topics, part 2** (`20261124185153_topics_view.sql`): eight kinds (customers, partners, projects, vendors, products, solutions, people, subjects); the map groups by Category and by Topic and lists a note's topics; the vault has a Folders / Topics switch and topic chips with Remove and Add.
- **Delete a workspace** in Settings (`20261124160731_workspace_delete.sql`); the DRA workspace was removed from the hosted hive (the local folder was not touched).
- **Settings, Topics made usable** (`7f7f4bb`): kinds fold, entries sit in columns in their own scroll box, All / None per kind, Save pinned to the bottom of the card.
- **Map, Topic by kind** (`b415f30`): under Group by Topic a "Kind" menu picks whose topics are the rings; the fold is named for the kind ("Other customers"); "All kinds" keeps the mixed view.
- Hosted, one-off, with Danijel's OK: 17 topics re-filed from customer to partner and 3 from subject to solution. All three migrations are applied on the hosted project.

## Why

Danijel saw that most notes in the real vault were unlinked: only wiki links created links, so 692 of 1,641 notes hung off nothing. He wants every note, decks and outputs included, to hang off a customer or a topic. Topics give that without anyone writing links by hand.

## How to test (for the user)

Pull `develop`, run the web app against the hosted project.

1. Settings, Topics: long kinds are folded; open Vendors and see columns in a short scrolling box.
2. Press "Find topics in my notes": folded kinds with ticked counts, Save visible without scrolling. Press None on one kind, tick two by hand, Save.
3. Vault: press "Attach topics" and let it finish (attached + already + none = scanned).
4. Vault, left column: switch Folders to Topics, open a kind, pick a topic; open a note and use Remove and Add topic on its chips.
5. Map, Group by Category: one ring per kind, "No topic" last.
6. Map, Group by Topic: a "Kind Customers" button appears; open it, choose Vendors, then Partners, then "All kinds".

## Open threads

- **Attach topics has not been run since the 25 new solutions were saved**: 312 topics, still 4,107 attachments.
- 467 notes already hold five topics and take no new one; a run only adds. Replacing a weak topic with a stronger one is not built.
- 332 notes have no topic. Vendors keeps a large "Other vendors" (125 vendors lead one or two notes each).
- Six names are both a partner and a vendor topic (ANYbotics, Boston Dynamics, Flyability, GODO, Qualcomm, UVR).
- Fine tuning asked for later: click "Other ..." to list its topics; remember the chosen kind after a reload; a search box in Settings topics.
- Carried gaps: a failed topics read looks like an empty hive; the hover card still calls the group "Topic"; the five-topic limit is in the app, not the database; an agent can attach (not remove) its member's note to a topic by a direct insert; Settings reads at most 1,000 topics; nested tags like `client/zain` are not matched.
- Whether the hosted API caps a request at 1,000 rows was assumed, not confirmed; the vault now reads in pages either way.
- `_draft-2026-11-24-1814.md` is another session's stub and was left in place.

## Next session entry point

Have Danijel run Attach topics, then decide the fine-tuning round (replace weak topics on full notes, open the "Other" ring, remember the kind). None of this is deployed to the site or promoted to `main` yet.
