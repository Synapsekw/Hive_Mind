import { redirect } from "next/navigation";
import { HiveMap } from "../map/Map";
import { Notice } from "../shell/Notice";
import { createServerSupabase } from "../lib/supabase/server";
import { claimIn } from "./auth/claim";
import { loadInboxCount } from "./inbox/load-inbox";
import { loadMap } from "./load-map";
import { Refresher } from "./Refresher";

// Reads the session cookie, so never prerendered.
export const dynamic = "force-dynamic";

export default async function Home() {
  const db = await createServerSupabase();
  const [result, inbox] = await Promise.all([loadMap(db), loadInboxCount(db)]);

  if (result.state === "no-hive") {
    // Someone who signed in with a password, or was invited after their last sign-in, joins
    // here. Only a hive actually joined redirects, so this cannot loop. `redirect` works by
    // throwing: keep it outside any try/catch.
    if ((await claimIn(db)) > 0) redirect("/");
    return (
      <Notice>
        You&apos;re not in a hive yet. Ask its owner to invite you.
      </Notice>
    );
  }
  if (result.state === "error") {
    return <Notice tryAgain>Couldn&apos;t load the hive.</Notice>;
  }
  return (
    <>
      <Refresher />
      <HiveMap payload={result.payload} now={Date.now()} inbox={inbox} />
    </>
  );
}
