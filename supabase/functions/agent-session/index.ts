// The Edge runtime's entry point: read the environment, hand over to session.ts.
import { handle } from "./session.ts";

// The publishable key comes from the function secret HIVE_PUBLISHABLE_KEY. The
// runtime's own SUPABASE_ANON_KEY is the legacy anon JWT, which stops working
// when the legacy JWT secret is revoked, so it is only the fallback for a
// project where the secret is not set.
const publishableKey =
  Deno.env.get("HIVE_PUBLISHABLE_KEY") ||
  Deno.env.get("SUPABASE_ANON_KEY") ||
  "";

Deno.serve((req) =>
  handle(req, {
    url: Deno.env.get("SUPABASE_URL") ?? "",
    anonKey: publishableKey,
    signingJwk: Deno.env.get("AGENT_SIGNING_JWK"),
  }),
);
