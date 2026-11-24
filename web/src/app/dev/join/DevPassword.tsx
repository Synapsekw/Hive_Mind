"use client";

// The password step with stand-in writes: no password is set anywhere and nothing typed is
// kept. Each call is recorded on `window.__joinCalls` for the browser tests, with the names of
// the fields that were sent and never their values.
import { Password } from "../../../join/Password";
import type { PasswordSaved } from "../../../join/types";

const WAIT = 150;

type Reason = Extract<PasswordSaved, { ok: false }>["reason"];

export function DevPassword({
  email,
  reason,
}: {
  email: string;
  /** Save is answered with this reason; null means it works. */
  reason: Reason | null;
}) {
  async function save(formData: FormData): Promise<PasswordSaved> {
    (window.__joinCalls ??= []).push({
      what: "save",
      args: [...formData.keys()].sort(),
    });
    await new Promise<void>((resolve) => setTimeout(resolve, WAIT));
    return reason ? { ok: false, reason } : { ok: true };
  }

  async function skip() {
    (window.__joinCalls ??= []).push({ what: "skip", args: [] });
    await new Promise<void>((resolve) => setTimeout(resolve, WAIT));
  }

  return (
    <Password
      email={email}
      save={save}
      skip={skip}
      after="/dev/join?state=joined"
    />
  );
}
