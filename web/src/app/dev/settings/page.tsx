import { notFound } from "next/navigation";
import { fixtureSettings } from "../../../settings/fixture";
import type { AddReason } from "../../../settings/types";
import { DevSettings } from "./DevSettings";

// A development page: the settings over the built-in fixture. Never served in production.
// A fixed clock keeps every render, and so every test and screenshot, the same.
//   ?member=1               the view of a member who is not the owner
//   ?none=1                 no agents yet
//   ?fail=1                 every action is refused
//   ?slow=1                 creating an agent takes over a second
//   ?reason=no-account      adding a member answers that nobody has that email
//   ?reason=already-member  adding a member answers that the person is already in
const NOW = Date.UTC(2026, 10, 23, 12, 0, 0);

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

function reasonOf(v: string | undefined): AddReason | null {
  return v === "no-account" || v === "already-member" ? v : null;
}

export default async function DevSettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const q = await searchParams;
  const data = fixtureSettings({
    member: one(q.member) === "1",
    none: one(q.none) === "1",
  });
  return (
    <DevSettings
      initial={data}
      now={NOW}
      fail={one(q.fail) === "1"}
      slow={one(q.slow) === "1"}
      reason={reasonOf(one(q.reason))}
    />
  );
}
