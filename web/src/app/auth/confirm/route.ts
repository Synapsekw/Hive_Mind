import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createServerSupabase } from "../../../lib/supabase/server";
import { safeNext } from "../../../lib/safe-next";
import { claimIn } from "../claim";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = safeNext(searchParams.get("next"));

  const failed = () =>
    NextResponse.redirect(new URL("/login?error=link", request.url));

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return failed();

  try {
    const supabase = await createServerSupabase();
    let error: unknown = new Error("No code or token.");
    if (code) {
      ({ error } = await supabase.auth.exchangeCodeForSession(code));
    } else if (tokenHash && type) {
      ({ error } = await supabase.auth.verifyOtp({
        type,
        token_hash: tokenHash,
      }));
    }
    if (error) return failed();
    // The person is signed in: join the hives that invited this email. It answers 0 instead of
    // throwing, so a failure here never costs the person their sign-in.
    await claimIn(supabase);
  } catch {
    return failed();
  }

  return NextResponse.redirect(new URL(next, request.url));
}
