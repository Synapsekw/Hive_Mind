import { notFound } from "next/navigation";
import {
  FIXTURE_EMAIL,
  FIXTURE_TOKEN,
  FIXTURE_WAITING,
} from "../../../join/fixture";
import type { JoinView } from "../../../join/types";
import { DevJoin } from "./DevJoin";
import { DevPassword } from "./DevPassword";

// A development page: the Join page over fixtures, with no database and no auth server. Never
// served in production.
//   ?state=list      two invitations waiting (the default)
//   ?state=empty     signed in, nothing waiting
//   ?state=expired   the line for a link that can no longer be used
//   ?state=continue  an emailed link was opened: the Continue button
//   ?state=failed    the invitations could not be read
//   ?state=joined    where the fixture goes after Join
//   ?state=password  the optional password step after a new person joins
//     &reason=…      Save is answered with that reason (refused, failed, short, long, different)
//   ?new=1           Join leads on to ?state=password, as for a first invitation link
//   ?fail=1          Join is refused; Continue ends on the expired line
//   ?hive=…&by=…     another hive name and inviter on the first invitation (both are only shown)
//   ?email=…         another signed-in address (only shown); empty for none. On
//                    ?state=continue nobody is signed in unless this is given
//   ?switched=1      the list after Continue replaced another person's session
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const REASONS = ["short", "long", "different", "refused", "failed"] as const;
type Reason = (typeof REASONS)[number];
const reasonOf = (v: string | undefined): Reason | null =>
  REASONS.find((r) => r === v) ?? null;

export default async function DevJoinPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const q = await searchParams;
  const state = one(q.state) ?? "list";

  const email = one(q.email) ?? FIXTURE_EMAIL;

  const switched = one(q.switched) === "1";

  if (state === "password")
    return <DevPassword email={email} reason={reasonOf(one(q.reason))} />;

  let view: JoinView;
  if (state === "expired") view = { kind: "expired" };
  else if (state === "failed") view = { kind: "error" };
  else if (state === "empty" || state === "joined")
    view = { kind: "list", waiting: [], email, switched };
  else if (state === "continue")
    view = {
      kind: "continue",
      tokenHash: FIXTURE_TOKEN,
      type: "invite",
      email: one(q.email) ?? "",
    };
  else {
    const [first, ...rest] = FIXTURE_WAITING;
    view = {
      kind: "list",
      email,
      switched,
      waiting: [
        {
          ...first!,
          hiveName: one(q.hive) ?? first!.hiveName,
          invitedBy: one(q.by) ?? first!.invitedBy,
        },
        ...rest,
      ],
    };
  }
  return (
    <DevJoin
      view={view}
      fail={one(q.fail) === "1"}
      isNew={one(q.new) === "1"}
    />
  );
}
