"use client";

// The inbox over the fixture with stand-in actions: each records its call on
// `window.__inboxCalls` (for the browser tests) and answers after a short wait, the way a
// server action does. With `fail`, every action is refused.
import { Inbox } from "../../../inbox/Inbox";
import { FIXTURE_BODIES } from "../../../inbox/fixture";
import { openingOf } from "../../../inbox/text";
import type { InboxActions, InboxData, Result } from "../../../inbox/types";

declare global {
  interface Window {
    __inboxCalls?: { name: string; args: unknown[] }[];
  }
}

function record(name: string, args: unknown[]) {
  (window.__inboxCalls ??= []).push({ name, args });
}

const WAIT = 150;

export function DevInbox({
  data,
  now,
  fail,
}: {
  data: InboxData;
  now: number;
  fail: boolean;
}) {
  const answer = (): Promise<Result> =>
    new Promise((resolve) => setTimeout(() => resolve({ ok: !fail }), WAIT));

  const actions: InboxActions = {
    respondToLink: (id, accept) => {
      record("respondToLink", [id, accept]);
      return answer();
    },
    releaseNote: (id) => {
      record("releaseNote", [id]);
      return answer();
    },
    noteOpening: (id) => {
      record("noteOpening", [id]);
      return new Promise((resolve) =>
        setTimeout(() => {
          const body = FIXTURE_BODIES[id];
          resolve(
            fail || body === undefined
              ? { ok: false }
              : { ok: true, text: openingOf(body) },
          );
        }, WAIT),
      );
    },
  };
  return <Inbox data={data} now={now} actions={actions} />;
}
