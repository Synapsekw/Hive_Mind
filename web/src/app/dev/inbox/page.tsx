import { notFound } from "next/navigation";
import { fixtureInbox } from "../../../inbox/fixture";
import { DevInbox } from "./DevInbox";

// A development page: the inbox over the built-in fixture. Never served in production.
// A fixed clock keeps every render, and so every test and screenshot, the same.
//   ?fail=1   every action is refused
//   ?empty=1  nothing waits
//   ?many=1   the totals are above the 100 a load brings
const NOW = Date.UTC(2026, 10, 23, 12, 0, 0);

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function DevInboxPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const q = await searchParams;
  const data = fixtureInbox({
    empty: one(q.empty) === "1",
    many: one(q.many) === "1",
  });
  return <DevInbox data={data} now={NOW} fail={one(q.fail) === "1"} />;
}
