// The optional password step, right after a new person presses Join.
//
// Offered only to a browser that has just spent a first invitation link: Continue left a
// short-lived cookie, and without it this page leads straight to the map. The proxy keeps the
// page closed to a visitor with no session; the check here is the same one again, asked of the
// auth server. Nothing is read from the database and nothing is written by a visit: the
// password is set, or the offer dropped, only by the two server actions.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Password } from "../../../join/Password";
import { createServerSupabase } from "../../../lib/supabase/server";
import { setPassword, skipPassword } from "../actions";
import { signedInAs } from "../join";
import { isNew } from "../password";

// Reads cookies and the session, so never prerendered and never cached.
export const dynamic = "force-dynamic";

export default async function JoinPasswordPage() {
  if (!isNew(await cookies())) redirect("/");
  let who: { email: string } | null = null;
  try {
    who = await signedInAs(await createServerSupabase());
  } catch (e) {
    console.error(
      "join password page failed",
      e instanceof Error ? e.name : "",
    );
  }
  // `redirect` works by throwing, so it stays outside the try.
  if (!who) redirect("/login");
  return <Password email={who.email} save={setPassword} skip={skipPassword} />;
}
