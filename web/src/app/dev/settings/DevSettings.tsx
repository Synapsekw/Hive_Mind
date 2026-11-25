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
//
// Deleting the hive and cancelling that end in a full reload, so those two calls are recorded
// in `sessionStorage.__hiveDeletionCalls` and the state they leave is remembered there too: the
// reloaded page shows the hive being deleted, or not, as the real one would. With `closing` the
// hive is being deleted from the start; with `notName`, Delete hive answers that the name is
// not the hive's. While the hive is being deleted the page also draws the banner, as the root
// layout does for a signed-in person.
import { useEffect, useRef, useState } from "react";
import {
  FIXTURE_DELETE_AFTER,
  fixtureDeletion,
  fixtureHeads,
} from "../../../settings/fixture";
import { Settings } from "../../../settings/Settings";
import { AccountProvider } from "../../../shell/AccountContext";
import { ClosingBanner } from "../../../shell/ClosingBanner";
import { HiveActionsProvider } from "../../../shell/HiveActions";
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

const DELETION_CALLS = "__hiveDeletionCalls";
/** "1" once Delete hive was answered ok, "0" once Cancel deletion was; absent before either. */
const CLOSING = "__hiveClosing";

function recordDeletion(name: string, args: unknown[]) {
  const calls = JSON.parse(
    sessionStorage.getItem(DELETION_CALLS) ?? "[]",
  ) as unknown[];
  sessionStorage.setItem(
    DELETION_CALLS,
    JSON.stringify([...calls, { name, args }]),
  );
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
  many = false,
  slow,
  reason,
  unsent,
  wait: tooSoon,
  limit,
  closing: closingAtFirst,
  notName,
}: {
  initial: SettingsData;
  now: number;
  fail: boolean;
  /** Find offers forty vendors instead of the handful. */
  many?: boolean;
  slow: boolean;
  reason: Exclude<InviteReason, "failed"> | null;
  unsent: boolean;
  wait: boolean;
  limit: boolean;
  closing: boolean;
  notName: boolean;
}) {
  const [data, setData] = useState(initial);
  // Whether the hive is being deleted: the flag, until this tab's own Delete hive or Cancel
  // deletion says otherwise (read after mount; the server knows nothing of this tab's storage).
  const [closing, setClosing] = useState(closingAtFirst);
  useEffect(() => {
    const stored = sessionStorage.getItem(CLOSING);
    if (stored !== null) setClosing(stored === "1");
  }, []);

  const cancelHiveDeletion = async () => {
    recordDeletion("cancelHiveDeletion", []);
    await wait();
    if (fail) return { ok: false };
    sessionStorage.setItem(CLOSING, "0");
    return { ok: true };
  };
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
    requestHiveDeletion: async (typedName) => {
      recordDeletion("requestHiveDeletion", [typedName]);
      await wait();
      if (fail) return { ok: false, reason: "failed" };
      if (notName || typedName !== data.hiveName)
        return { ok: false, reason: "name" };
      sessionStorage.setItem(CLOSING, "1");
      return { ok: true };
    },
    cancelHiveDeletion,
    deleteWorkspace: async (id) => {
      record("deleteWorkspace", [id]);
      await wait();
      if (fail) return { ok: false, reason: "failed" };
      // As the database answers: a workspace with an agent still in use stays.
      if (
        data.agents.some((a) => a.workspaceId === id && a.status === "active")
      )
        return { ok: false, reason: "agents" };
      setData((d) => ({
        ...d,
        workspaces: d.workspaces.filter((w) => w.id !== id),
        agents: d.agents.filter((a) => a.workspaceId !== id),
      }));
      return { ok: true };
    },
    scanTopics: async (workspaceId, after) => {
      record("scanTopics", [workspaceId, after]);
      await wait();
      if (fail) return { ok: false };
      // Everything on the first workspace's first page; the others hold nothing.
      const first = data.workspaces[0]?.id === workspaceId && after === null;
      return { ok: true, heads: first ? fixtureHeads(many) : [], next: null };
    },
    saveTopics: async (picks) => {
      record("saveTopics", [picks]);
      await wait();
      if (fail) return { ok: false };
      setData((d) => ({
        ...d,
        topics: [
          ...d.topics,
          ...picks.map((p, i) => ({
            id: `00000000-0000-4000-8000-0000000b${String(100 + d.topics.length + i)}`,
            kind: p.kind,
            name: p.name,
            notes: 0,
          })),
        ],
      }));
      return { ok: true, saved: picks.length };
    },
    deleteTopic: async (id) => {
      record("deleteTopic", [id]);
      await wait();
      if (fail) return { ok: false };
      setData((d) => ({ ...d, topics: d.topics.filter((x) => x.id !== id) }));
      return { ok: true };
    },
  };
  const settings = (
    <Settings
      data={data}
      now={now}
      actions={actions}
      inbox={0}
      deletion={data.isOwner ? fixtureDeletion() : null}
      closing={closing ? FIXTURE_DELETE_AFTER : null}
    />
  );
  if (!closing) return settings;
  const me = data.members.find((m) => m.isMe);
  const role = me?.role ?? "member";
  return (
    <AccountProvider
      account={{
        name: me?.name ?? "",
        initials: (me?.name ?? "?").slice(0, 2).toUpperCase(),
        role,
        hive: data.hiveName,
        hiveId: "00000000-0000-4000-8000-0000000000a1",
        hives: [],
        closing: FIXTURE_DELETE_AFTER,
      }}
    >
      <HiveActionsProvider actions={null}>
        <ClosingBanner
          actions={{
            switchHive: async () => ({ ok: false }),
            createHive: async () => ({ ok: false, reason: "failed" }),
            cancelHiveDeletion,
          }}
        />
        {settings}
      </HiveActionsProvider>
    </AccountProvider>
  );
}
