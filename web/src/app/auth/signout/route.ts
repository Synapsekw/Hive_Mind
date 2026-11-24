import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "../../../lib/supabase/server";
import { safeNext } from "../../../lib/safe-next";
import { noHiveCookie } from "../../chosen-hive";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabase();
    // This browser only; the person's other sessions stay signed in.
    await supabase.auth.signOut({ scope: "local" });
  } catch {
    // Not configured or already signed out: nothing to clear.
  }
  // Always on to sign-in. A `next` is where sign-in returns afterwards: a path on this site
  // only (the Join page's "Not you?" sends `/join`), checked again there before it is followed.
  const next = safeNext(request.nextUrl.searchParams.get("next"));
  const to =
    next === "/" ? "/login" : `/login?next=${encodeURIComponent(next)}`;
  const res = NextResponse.redirect(new URL(to, request.url), 303);
  // The chosen hive goes with the session, whether or not signing out worked: the next person
  // to sign in on this browser starts at their own oldest hive.
  res.cookies.set(noHiveCookie(process.env.NODE_ENV === "production"));
  return res;
}
