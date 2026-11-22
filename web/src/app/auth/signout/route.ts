import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "../../../lib/supabase/server";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabase();
    // This browser only; the person's other sessions stay signed in.
    await supabase.auth.signOut({ scope: "local" });
  } catch {
    // Not configured or already signed out: nothing to clear.
  }
  return NextResponse.redirect(new URL("/login", request.url), 303);
}
