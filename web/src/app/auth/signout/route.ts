import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "../../../lib/supabase/server";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabase();
    await supabase.auth.signOut();
  } catch {
    // Not configured or already signed out: nothing to clear.
  }
  return NextResponse.redirect(new URL("/login", request.url), 303);
}
