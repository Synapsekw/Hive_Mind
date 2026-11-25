import { cache } from "react";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The signed-in person's client for this request. Within one server render it is the same
 * client for the layout and the page (React's `cache`), so their reads can share answers
 * (`own-hive.ts`); outside a render (server actions, route handlers) each call makes a new one.
 */
export const createServerSupabase = cache(
  async function createServerSupabase(): Promise<SupabaseClient> {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) {
      throw new Error("Supabase is not configured.");
    }
    const cookieStore = await cookies();
    return createServerClient(url, key, {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component, which cannot set cookies.
            // The proxy refreshes the session, so this is safe to ignore.
          }
        },
      },
    });
  },
);
