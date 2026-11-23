// The Join page. An invitation email links here as `/join?token_hash=…&type=…`.
//
// Opening that link spends nothing: this render only draws the Continue button, with the token
// in the form's hidden fields. The link is spent by the button's server action, so a mail
// scanner that pre-opens the address cannot use it up. The action returns here with no token in
// the address, and this render then lists the invitations of whoever is signed in now, read
// from the database every time (one call, `my_invitations`), under that person's address. Joining is one more call.
//
// The proxy lets a visitor with no session in only for a link or the expired line; anyone else
// is sent to sign in and comes back.
import { redirect } from "next/navigation";
import { Join } from "../../join/Join";
import type { JoinView } from "../../join/types";
import { createServerSupabase } from "../../lib/supabase/server";
import { continueWithLink, join } from "./actions";
import { signedInAs, viewOf, waitingIn } from "./join";

// Reads the session cookie, so never prerendered.
export const dynamic = "force-dynamic";

export default async function JoinPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const visit = viewOf(await searchParams);
  let view: JoinView;
  if (visit.kind === "list") {
    let signedIn = true;
    try {
      const db = await createServerSupabase();
      // Asked of the auth server, so the address shown is the one of the session in use now.
      const who = await signedInAs(db);
      signedIn = who !== null;
      const waiting = who ? await waitingIn(db) : "error";
      view =
        who && waiting !== "error"
          ? {
              kind: "list",
              waiting,
              email: who.email,
              switched: visit.switched,
            }
          : { kind: "error" };
    } catch (e) {
      console.error("join page failed", e instanceof Error ? e.name : "");
      view = { kind: "error" };
    }
    // `redirect` works by throwing, so it stays outside the try.
    if (!signedIn) redirect("/login?next=%2Fjoin");
  } else if (visit.kind === "continue") {
    // Somebody may be signed in already: Continue would replace them, so the button says who.
    // Reading that spends nothing; a failure only leaves the warning out.
    let email = "";
    try {
      email = (await signedInAs(await createServerSupabase()))?.email ?? "";
    } catch (e) {
      console.error("join page failed", e instanceof Error ? e.name : "");
    }
    view = { ...visit, email };
  } else {
    view = visit;
  }
  return <Join view={view} continueWithLink={continueWithLink} join={join} />;
}
