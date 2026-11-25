"use client";

// The rail over a sample account with stand-in actions: nothing is switched or created anywhere
// but in this tab. Each call is recorded in `sessionStorage.__hiveCalls` (it must outlive the
// reload a switch ends in) for the browser tests. A switch is remembered the same way, so the
// reloaded page shows the hive that was chosen, as the real cookie would. With `closing` the
// hive on show is being deleted: the banner is drawn above the rail, as the root layout draws
// it, and a cancelled deletion is remembered the same way.
import { useEffect, useState } from "react";
import { AccountProvider } from "../../../shell/AccountContext";
import { ClosingBanner } from "../../../shell/ClosingBanner";
import {
  HiveActionsProvider,
  type HiveActions,
} from "../../../shell/HiveActions";
import type { HiveEntry } from "../../../shell/hiveText";
import { NoHive } from "../../../shell/NoHive";
import notice from "../../../shell/notice.module.css";
import { Shell } from "../../../shell/Shell";

const CALLS = "__hiveCalls";
const CHOSEN = "__hiveChosen";
const CANCELLED = "__hiveDeletionCancelled";
/** When the sample hive is erased, with `closing`. */
const DELETE_AFTER = "2026-11-30T12:00:00.000Z";
const WAIT = 150;
/** How long an action takes with `slow`: long enough to look at the form meanwhile. */
const SLOW_WAIT = 1200;

const HIVES = [
  {
    id: "00000000-0000-4000-8000-0000000000a1",
    name: "Keystone Studio",
    role: "owner",
  },
  {
    id: "00000000-0000-4000-8000-0000000000a2",
    name: "Atlas Research",
    role: "member",
  },
  {
    id: "00000000-0000-4000-8000-0000000000a3",
    name: "Night Shift",
    role: "owner",
  },
] as const;

function record(name: string, args: unknown[]) {
  const calls = JSON.parse(sessionStorage.getItem(CALLS) ?? "[]") as unknown[];
  sessionStorage.setItem(CALLS, JSON.stringify([...calls, { name, args }]));
}

export function DevRail({
  single,
  plain,
  none,
  fail,
  limit,
  reason,
  slow,
  closing,
}: {
  single: boolean;
  plain: boolean;
  none: boolean;
  fail: boolean;
  limit: boolean;
  reason: "name" | "display-name" | null;
  slow: boolean;
  closing: boolean;
}) {
  // The hive a switch chose, read after mount (the server knows nothing of this tab's storage).
  const [chosen, setChosen] = useState<string>(HIVES[0].id);
  const [cancelled, setCancelled] = useState(false);
  useEffect(() => {
    const id = sessionStorage.getItem(CHOSEN);
    if (id && HIVES.some((h) => h.id === id)) setChosen(id);
    setCancelled(sessionStorage.getItem(CANCELLED) === "1");
  }, []);

  const wait = () =>
    new Promise<void>((resolve) =>
      setTimeout(resolve, slow ? SLOW_WAIT : WAIT),
    );

  const actions: HiveActions = {
    switchHive: async (hiveId) => {
      record("switchHive", [hiveId]);
      await wait();
      if (fail || !HIVES.some((h) => h.id === hiveId)) return { ok: false };
      sessionStorage.setItem(CHOSEN, hiveId);
      return { ok: true };
    },
    createHive: async (name, displayName) => {
      record("createHive", [name, displayName]);
      await wait();
      if (fail) return { ok: false, reason: "failed" };
      if (limit) return { ok: false, reason: "limit" };
      if (reason) return { ok: false, reason };
      return { ok: true };
    },
    cancelHiveDeletion: async (hiveId) => {
      record("cancelHiveDeletion", [hiveId]);
      await wait();
      if (fail) return { ok: false };
      sessionStorage.setItem(CANCELLED, "1");
      return { ok: true };
    },
  };

  // The root layout provides the real actions to every page; "plain" stands for a page that
  // has none, so it says so here.
  if (none)
    return (
      <HiveActionsProvider actions={plain ? null : actions}>
        <NoHive />
      </HiveActionsProvider>
    );

  const shown = single ? HIVES.slice(0, 1) : HIVES;
  const current = shown.find((h) => h.id === chosen) ?? shown[0]!;
  // Only the hive on show is being deleted.
  const going = closing && !cancelled;
  const hives = shown.map((h) => ({
    ...h,
    current: h.id === current.id,
    closing: going && h.id === current.id,
  })) satisfies HiveEntry[];
  const account = {
    name: "Mara Lind",
    initials: "ML",
    role: current.role,
    hive: current.name,
    hiveId: current.id,
    hives,
    closing: going ? DELETE_AFTER : null,
  };

  return (
    <AccountProvider account={account}>
      <HiveActionsProvider actions={plain ? null : actions}>
        <ClosingBanner />
        <div className={notice.root}>
          <Shell current="map" />
          <main aria-label="Hive map" className={notice.card} />
        </div>
      </HiveActionsProvider>
    </AccountProvider>
  );
}
