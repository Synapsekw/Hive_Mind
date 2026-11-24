"use client";
import { createContext, useContext, type ReactNode } from "react";
import type { Account } from "../app/account";

const Ctx = createContext<Account | null>(null);

export function AccountProvider({
  account,
  children,
}: {
  account: Account | null;
  children: ReactNode;
}) {
  return <Ctx.Provider value={account}>{children}</Ctx.Provider>;
}

export const useAccount = (): Account | null => useContext(Ctx);
