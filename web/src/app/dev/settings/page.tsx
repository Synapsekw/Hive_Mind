import { notFound } from "next/navigation";
import { fixtureSettings } from "../../../settings/fixture";
import { tabFromParam } from "../../../settings/tabs";
import { DevSettings } from "./DevSettings";

// A development page: the settings over the built-in fixture. Never served in production.
// A fixed clock keeps every render, and so every test and screenshot, the same.
//   ?member=1               the view of a member who is not the owner
//   ?none=1                 no agents yet
//   ?many=1                 thirty more topics, and forty more for Find to offer
//   ?fail=1                 every action is refused
//   ?slow=1                 creating an agent takes over a second
//   ?unsent=1               inviting saves the invitation, but its email is not sent
//   ?wait=1                 Send again answers that an email went out a moment ago
//   ?limit=1                Send again answers that the invitation has been emailed 5 times
//   ?reason=already-member  inviting answers that the person is already in
//   ?reason=already-invited inviting answers that the email already has an open invitation
//   ?reason=too-many        inviting answers that the hive has made its invitations for the day
//   ?closing=1              the hive is being deleted: the banner, and Cancel deletion for the owner
//   ?notname=1              Delete hive answers that the typed name is not the hive's
//   ?tab=people             the tab open at first, as on the real page
const NOW = Date.UTC(2026, 10, 23, 12, 0, 0);

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

function reasonOf(
  v: string | undefined,
): "already-member" | "already-invited" | "too-many" | null {
  return v === "already-member" || v === "already-invited" || v === "too-many"
    ? v
    : null;
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
    many: one(q.many) === "1",
  });
  return (
    <DevSettings
      initial={data}
      now={NOW}
      fail={one(q.fail) === "1"}
      many={one(q.many) === "1"}
      slow={one(q.slow) === "1"}
      reason={reasonOf(one(q.reason))}
      unsent={one(q.unsent) === "1"}
      wait={one(q.wait) === "1"}
      limit={one(q.limit) === "1"}
      closing={one(q.closing) === "1"}
      notName={one(q.notname) === "1"}
      tab={tabFromParam(one(q.tab), data.isOwner)}
    />
  );
}
