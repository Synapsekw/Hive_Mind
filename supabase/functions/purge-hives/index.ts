// The Edge runtime's entry point: read the environment, hand over to purge.ts.
import { handle } from "./purge.ts";

// The secret key: HIVE_SECRET_KEY when set, else the runtime's legacy
// service-role key, which stops working when the legacy JWT secret is revoked.
// It is sent to this project's database and Storage and nowhere else.
const serviceKey =
  Deno.env.get("HIVE_SECRET_KEY") ||
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
  undefined;

Deno.serve((req) =>
  handle(req, {
    url: Deno.env.get("SUPABASE_URL") ?? "",
    serviceKey,
    // What the database's scheduler shows in `x-purge-secret`; stored by
    // scripts/setup-hive-purge.sh.
    purgeSecret: Deno.env.get("HIVE_PURGE_SECRET") || undefined,
  }),
);
