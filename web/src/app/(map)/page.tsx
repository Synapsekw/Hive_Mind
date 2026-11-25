import { redirect } from "next/navigation";
import { HiveMap } from "../../map/Map";
import { NoHive } from "../../shell/NoHive";
import { Notice } from "../../shell/Notice";
import { createServerSupabase } from "../../lib/supabase/server";
import { loadInboxCount } from "../inbox/load-inbox";
import { loadMap } from "../load-map";
import { afterNoHive } from "../no-hive";
import { Refresher } from "../Refresher";

// Reads the session cookie, so never prerendered.
export const dynamic = "force-dynamic";

export default async function Home() {
  const db = await createServerSupabase();
  const [result, inbox] = await Promise.all([loadMap(db), loadInboxCount(db)]);

  if (result.state === "no-hive") {
    // Invited, but not a member until they press Join: on to the page that asks. `/join` only
    // leads back here once a hive was joined, so this cannot loop. `redirect` works by
    // throwing: keep it outside any try/catch.
    const to = await afterNoHive(db);
    if (to) redirect(to);
    // The sentence and, where a hive can be started, the New hive form.
    return <NoHive />;
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
