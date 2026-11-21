---
type: spec
status: active
last-updated: 2026-11-21
tags: [project/hive-mind, user-stories]
---

# Hive Mind — User Stories

Three roles: Owner, Member and Agent. The Agent is a first-class user because it does most of the
reading and writing. Priority: must (phases 1–3), should (phases 4–5), later (phase 6).

## Owner

| Story                                                                             | Acceptance                                                                                         | Priority |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------- |
| As the owner, I invite a colleague by email so that only chosen people can join.  | Invite link expires in 7 days; uninvited sign-ins are refused.                                     | must     |
| As the owner, I remove a member so that their access ends immediately.            | All their tokens are revoked within a minute; their shared notes stay or are withdrawn, my choice. | must     |
| As the owner, I manage the entity registry so that DMT is one thing for everyone. | I can merge two entities and confirm or reject suggested aliases.                                  | must     |
| As the owner, I see an audit trail of every read and write per agent.             | Filter by member, agent, note, date.                                                               | must     |
| As the owner, I set group-wide defaults for sharing and agent trust tiers.        | New members inherit defaults; they can tighten but not loosen.                                     | should   |

## Member

| Story                                                                                                          | Acceptance                                                                                | Priority |
| -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | -------- |
| As a member, I connect my Claude or ChatGPT project in five minutes so that my agent writes into my own space. | Token created, connector added, instructions pasted; first write visible in the Vault.    | must     |
| As a member, I keep personal work private by default so that nothing leaks.                                    | Private is the default; nothing is visible to others until I change it.                   | must     |
| As a member, I share a whole folder with the group so that I do not click every note.                          | Folder rule applies to existing and future notes inside it.                               | must     |
| As a member, I get told when a colleague works on the same client so that we can consolidate.                  | Notification names the entity only; I accept or decline; nothing moves until both accept. | must     |
| As a member, I see the whole hive as a map so that I understand what the group knows.                          | Filter by topic, kind and person; click a dot to open it.                                 | must     |
| As a member, I revoke a token so that a lost laptop cannot write into my space.                                | Takes effect on the next sign-in; audit shows the last use.                               | must     |
| As a member, I read one synthesis page per client so that I do not reconcile five people's notes.              | Every fact cites its source note and owner; contradictions are flagged.                   | should   |
| As a member, I browse my generated documents in a gallery and preview them in place.                           | PDF, PPTX, XLSX and images open full-screen without download.                             | should   |
| As a member, I widen the gallery to the whole hive so that I can reuse colleagues' deliverables.               | Only files whose visibility allows me appear.                                             | should   |
| As a member, I chat with the hive in the browser on my own subscription so that I pay no API fees.             | Sign in with Claude or ChatGPT; the page shows which plan is in use.                      | later    |

## Agent

| Story                                                                                                       | Acceptance                                                                 | Priority |
| ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | -------- |
| As an agent, I write a durable fact as soon as the user states it so that nothing is lost if the chat ends. | Write succeeds in under a second; version history kept.                    | must     |
| As an agent, I never change visibility so that sharing stays a human decision.                              | The database refuses it for any agent identity.                            | must     |
| As an agent, I save a deliverable with its path so that it appears in the gallery.                          | File lands under `outputs/<type>/<customer>/` and is linked to a note.     | must     |
| As an agent, I read the synthesis page first so that I answer from one current view.                        | Search returns synthesis pages before raw notes.                           | should   |
| As an agent, I report an overlap once and stop so that I do not nag.                                        | One mention per session per entity.                                        | should   |
| As a self-hosted agent, my writes are held so that the member reviews before anyone else sees them.         | Lower trust tier set at token creation; release is one click in the Vault. | should   |

## Decisions

- A removed member's shared content stays by default: accepted links and synthesis pages depend on
  it and it is group work product. The owner can withdraw it as an exception.
- Agents may propose a visibility change as an inbox card, but never set it. Sharing stays a human
  click.
