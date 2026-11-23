"use client";

// The settings over the fixture with stand-in actions. The page keeps its own copy of the data
// and changes it the way the database would, so the list gains the new agent, a revoked one
// dims and an added member appears. Each call is recorded on `window.__settingsCalls` (for the
// browser tests) with what was asked and never with the token that was answered. With `fail`,
// every action is refused; `reason` is what adding a member answers.
import { useState } from "react";
import { Settings } from "../../../settings/Settings";
import type {
  AddReason,
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
/** Not a real token: the database has never seen it. */
const DEV_TOKEN = "hive_devtoken0000000000000000000000000000";

const wait = () => new Promise<void>((resolve) => setTimeout(resolve, WAIT));
const idOf = (kind: "d" | "f", n: number) =>
  `00000000-0000-4000-8000-00000000${kind}${String(100 + n)}`;

export function DevSettings({
  initial,
  now,
  fail,
  reason,
}: {
  initial: SettingsData;
  now: number;
  fail: boolean;
  reason: AddReason | null;
}) {
  const [data, setData] = useState(initial);

  const actions: SettingsActions = {
    createAgent: async (input) => {
      record("createAgent", [input]);
      await wait();
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
    addMember: async (email, name) => {
      record("addMember", [email, name]);
      await wait();
      if (fail) return { ok: false, reason: "failed" };
      if (reason) return { ok: false, reason };
      setData((d) => ({
        ...d,
        members: [
          ...d.members,
          {
            id: idOf("f", d.members.length),
            name,
            role: "member",
            isMe: false,
          },
        ],
      }));
      return { ok: true };
    },
  };
  return <Settings data={data} now={now} actions={actions} inbox={0} />;
}
