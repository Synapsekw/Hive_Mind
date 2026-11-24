import { notFound } from "next/navigation";
import { fixturePayload } from "../../../map/fixture";
import { HiveMap } from "../../../map/Map";

/** A whole number above zero from a query value, at most `max`; anything else is undefined. */
function count(param: string | string[] | undefined, max: number) {
  const raw = (Array.isArray(param) ? param[0] : param)?.trim() ?? "";
  const n = Math.floor(Number(raw));
  return raw !== "" && Number.isFinite(n) && n > 0
    ? Math.min(max, n)
    : undefined;
}

// A development page: the map over the built-in fixture hive. Never served in production.
// `?items=5000` grows the fixture (up to 5,000 items) for the performance test. `?inbox=2` says
// that many wait in the inbox, so the panel's "Needs you" row and the folded strip's badge show.
export default async function DevMapPage({
  searchParams,
}: {
  searchParams: Promise<{
    items?: string | string[];
    inbox?: string | string[];
  }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const params = await searchParams;
  // Empty, non-numeric, zero or negative: the plain fixture, nothing waiting.
  const items = count(params.items, 5000);
  const inbox = count(params.inbox, 99);
  const now = Date.now();
  return (
    <HiveMap
      payload={fixturePayload(now, items !== undefined ? { items } : {})}
      now={now}
      inbox={inbox}
    />
  );
}
