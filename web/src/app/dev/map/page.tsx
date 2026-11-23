import { notFound } from "next/navigation";
import { fixturePayload } from "../../../map/fixture";
import { HiveMap } from "../../../map/Map";

// A development page: the map over the built-in fixture hive. Never served in production.
// `?items=5000` grows the fixture (up to 5,000 items) for the performance test.
export default async function DevMapPage({
  searchParams,
}: {
  searchParams: Promise<{ items?: string | string[] }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const raw = (await searchParams).items;
  const n = Number(Array.isArray(raw) ? raw[0] : raw);
  const items =
    raw !== undefined && Number.isFinite(n) ? Math.min(5000, n) : undefined;
  const now = Date.now();
  return (
    <HiveMap
      payload={fixturePayload(now, items !== undefined ? { items } : {})}
      now={now}
    />
  );
}
