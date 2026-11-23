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

export function DevJoin({ view, fail }: { view: JoinView; fail: boolean }) {
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
    return { ok: !fail };
  }

  return (
    <Join
      view={view}
      continueWithLink={continueWithLink}
      join={join}
      after="/dev/join?state=joined"
    />
  );
}
