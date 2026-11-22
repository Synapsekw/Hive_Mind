import { HiveMap } from "../map/Map";
import { Notice } from "../map/Notice";
import { createServerSupabase } from "../lib/supabase/server";
import { loadMap } from "./load-map";
import { Refresher } from "./Refresher";

// Reads the session cookie, so never prerendered.
export const dynamic = "force-dynamic";

export default async function Home() {
  const db = await createServerSupabase();
  const result = await loadMap(db);

  if (result.state === "no-hive") {
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
      <HiveMap payload={result.payload} now={Date.now()} />
    </>
  );
}
