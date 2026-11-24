import { notFound } from "next/navigation";
import { DevRail } from "./DevRail";

// A development page: the rail for a person in three sample hives, with stand-in actions and no
// database. Never served in production.
//   ?one=1     the person is in one hive only
//   ?plain=1   no actions are given: the switcher only shows the hives
//   ?none=1    the home page's notice for a person in no hive, with New hive
//   ?fail=1    switching and creating are refused with the usual failure line
//   ?limit=1   creating answers that the person already owns 5 hives
//   ?reason=…  creating answers with that reason (name, display-name)
//   ?slow=1    each action takes over a second
//   ?closing=1 the hive on show is being deleted: the banner, and the mark in the list
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const reasonOf = (v: string | undefined): "name" | "display-name" | null =>
  v === "name" || v === "display-name" ? v : null;

export default async function DevRailPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const q = await searchParams;
  return (
    <DevRail
      single={one(q.one) === "1"}
      plain={one(q.plain) === "1"}
      none={one(q.none) === "1"}
      fail={one(q.fail) === "1"}
      limit={one(q.limit) === "1"}
      reason={reasonOf(one(q.reason))}
      slow={one(q.slow) === "1"}
      closing={one(q.closing) === "1"}
    />
  );
}
