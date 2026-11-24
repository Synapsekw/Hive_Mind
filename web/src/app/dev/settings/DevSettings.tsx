"use client";

// The settings over the fixture with stand-in actions. The page keeps its own copy of the data
// and changes it the way the database would, so the list gains the new agent, a revoked one
// dims, a new invitation appears and a revoked invitation goes. Inviting never adds a member:
// the person joins by pressing Join. Each call is recorded on `window.__settingsCalls` (for the
// browser tests) with what was asked and never with the token that was answered. With `fail`,
// every action is refused; with `slow`, creating an agent takes over a second; `reason` is why
// inviting is refused; with `unsent`, an invitation is saved but its email is not sent; with
// `wait`, Send again answers that one was sent a moment ago; with `limit`, that the invitation
// has been emailed as often as it may be.
import { useRef, useState } from "react";
import { Settings } from "../../../settings/Settings";
import type {
  InviteReason,
  SettingsActions,
  SettingsData,
} from "../../../settings/types";

declare global {
  interface Window {
    __settingsCalls?: { name: string; args: unknown[] }[];
  }
}

function record(name: string, args: unknown[]) {
  (window.__settingsCalls ??= []).push({ name, args });
}

const WAIT = 150;
/** How long `createAgent` takes with `slow`: long enough to press something meanwhile. */
const SLOW_WAIT = 1200;
/** Not a real token: the database has never seen it. */
const DEV_TOKEN = "hive_devtoken0000000000000000000000000000";

const wait = (ms = WAIT) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
/** An invitation stays open this long, as in the database. */
const OPEN_FOR_MS = 14 * 24 * 60 * 60 * 1000;
const idOf = (kind: "c" | "d", n: number) =>
  `00000000-0000-4000-8000-00000000${kind}${String(100 + n)}`;

export function DevSettings({
  initial,
  now,
  fail,
  slow,
  reason,
  unsent,
  wait: tooSoon,
  limit,
}: {
  initial: SettingsData;
  now: number;
  fail: boolean;
  slow: boolean;
  reason: Exclude<InviteReason, "failed"> | null;
  unsent: boolean;
  wait: boolean;
  limit: boolean;
}) {
  const [data, setData] = useState(initial);
  // How many invitations this page has made, so each new one gets its own id.
  const count = useRef(0);

  const actions: SettingsActions = {
    createAgent: async (input) => {
      record("createAgent", [input]);
      await wait(slow ? SLOW_WAIT : WAIT);
      if (fail) return { ok: false };
      setData((d) => ({
        ...d,
        agents: [
          ...d.agents,
          {
            id: idOf("d", d.agents.length),
            name: input.name,
            provider: input.provider,
            trustTier: input.trustTier,
            workspaceId: input.workspaceId,
            createdAt: new Date(now).toISOString(),
            lastUsedAt: null,
            status: "active",
          },
        ],
      }));
      return { ok: true, token: DEV_TOKEN };
    },
    revokeAgent: async (id) => {
      record("revokeAgent", [id]);
      await wait();
      if (fail) return { ok: false };
      setData((d) => ({
        ...d,
        agents: d.agents.map((a) =>
          a.id === id ? { ...a, status: "revoked" } : a,
        ),
      }));
      return { ok: true };
    },
    inviteMember: async (email, name) => {
      record("inviteMember", [email, name]);
      await wait();
      if (fail) return { ok: false, reason: "failed" };
      if (reason) return { ok: false, reason };
      count.current += 1;
      const id = idOf("c", count.current);
      // Newest first and the email in lower case, as the database stores and returns them.
      setData((d) => ({
        ...d,
        invitations: [
          {
            id,
            email: email.toLowerCase(),
            name,
            createdAt: new Date(now).toISOString(),
            expiresAt: new Date(now + OPEN_FOR_MS).toISOString(),
          },
          ...d.invitations,
        ],
      }));
      return { ok: true, id, sent: !unsent };
    },
    resendInvitation: async (id) => {
      record("resendInvitation", [id]);
      await wait();
      if (fail) return { ok: false, reason: "failed" };
      if (tooSoon) return { ok: false, reason: "wait" };
      if (limit) return { ok: false, reason: "limit" };
      return { ok: true };
    },
    revokeInvitation: async (id) => {
      record("revokeInvitation", [id]);
      await wait();
      if (fail) return { ok: false };
      setData((d) => ({
        ...d,
        invitations: d.invitations.filter((i) => i.id !== id),
      }));
      return { ok: true };
    },
  };
  return <Settings data={data} now={now} actions={actions} inbox={0} />;
}
