// The Edge runtime's entry point: read the environment, hand over to send.ts.
import { handle } from "./send.ts";

// The publishable key comes from the function secret HIVE_PUBLISHABLE_KEY. The
// runtime's own SUPABASE_ANON_KEY is the legacy anon JWT, which stops working
// when the legacy JWT secret is revoked, so it is only the fallback for a
// project where the secret is not set.
const publishableKey =
  Deno.env.get("HIVE_PUBLISHABLE_KEY") ||
  Deno.env.get("SUPABASE_ANON_KEY") ||
  "";

// The secret key likewise: HIVE_SECRET_KEY when set, else the runtime's legacy
// service-role key. It is sent to this project's Auth and nowhere else.
const secretKey =
  Deno.env.get("HIVE_SECRET_KEY") ||
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
  undefined;

Deno.serve((req) =>
  handle(req, {
    url: Deno.env.get("SUPABASE_URL") ?? "",
    anonKey: publishableKey,
    secretKey,
    resendKey: Deno.env.get("RESEND_API_KEY"),
    from: Deno.env.get("HIVE_INVITE_FROM"),
    siteUrl: Deno.env.get("HIVE_SITE_URL"),
  }),
);
