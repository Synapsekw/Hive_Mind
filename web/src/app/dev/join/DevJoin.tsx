"use client";

// The Join page with stand-in writes: no link is spent and no hive is joined. Each call is
// recorded on `window.__joinCalls` for the browser tests.
import { Join } from "../../../join/Join";
import type { Joined, JoinView } from "../../../join/types";

declare global {
  interface Window {
    __joinCalls?: { what: string; args: unknown[] }[];
  }
}

const WAIT = 150;

export function DevJoin({
  view,
  fail,
  isNew,
}: {
  view: JoinView;
  fail: boolean;
  /** As if the browser carried the new-person cookie: Join leads on to the password page. */
  isNew: boolean;
}) {
  async function continueWithLink(formData: FormData) {
    (window.__joinCalls ??= []).push({
      what: "continue",
      args: [formData.get("token_hash"), formData.get("type")],
    });
    await new Promise<void>((resolve) => setTimeout(resolve, WAIT));
    window.location.assign(fail ? "/dev/join?state=expired" : "/dev/join");
  }

  async function join(id: string): Promise<Joined> {
    (window.__joinCalls ??= []).push({ what: "join", args: [id] });
    await new Promise<void>((resolve) => setTimeout(resolve, WAIT));
    if (fail) return { ok: false };
    return { ok: true, next: isNew ? "/join/password" : "/" };
  }

  return (
    <Join
      view={view}
      continueWithLink={continueWithLink}
      join={join}
      after="/dev/join?state=joined"
      afterNew="/dev/join?state=password"
    />
  );
}
