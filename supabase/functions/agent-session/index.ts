// The Edge runtime's entry point: read the environment, hand over to session.ts.
import { handle } from "./session.ts";

Deno.serve((req) =>
  handle(req, {
    url: Deno.env.get("SUPABASE_URL") ?? "",
    anonKey: Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    signingJwk: Deno.env.get("AGENT_SIGNING_JWK"),
  }),
);
