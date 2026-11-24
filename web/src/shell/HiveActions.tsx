"use client";

// What a person can do to their hives from the rail and the banner: switch to another, start a
// new one and, for a hive that is being deleted, cancel that. A screen may hand them to its Shell; otherwise they come from this context, so one
// provider near the root serves every rail. With neither, the switcher only shows the hives.
import { createContext, useContext, type ReactNode } from "react";
import type { Created } from "./hiveText";

export type HiveActions = {
  switchHive: (hiveId: string) => Promise<{ ok: boolean }>;
  createHive: (name: string, displayName: string) => Promise<Created>;
  /** Takes a hive's deletion back. The database decides whether the person may. */
  cancelHiveDeletion?: (hiveId: string) => Promise<{ ok: boolean }>;
};

const Ctx = createContext<HiveActions | null>(null);

export function HiveActionsProvider({
  actions,
  children,
}: {
  actions: HiveActions | null;
  children: ReactNode;
}) {
  return <Ctx.Provider value={actions}>{children}</Ctx.Provider>;
}

export const useHiveActions = (): HiveActions | null => useContext(Ctx);
