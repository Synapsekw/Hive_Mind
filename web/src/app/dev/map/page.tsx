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
  const param = (await searchParams).items;
  const raw = (Array.isArray(param) ? param[0] : param)?.trim() ?? "";
  const n = Math.floor(Number(raw));
  // Empty, non-numeric, zero or negative: the plain fixture.
  const items =
    raw !== "" && Number.isFinite(n) && n > 0 ? Math.min(5000, n) : undefined;
  const now = Date.now();
  return (
    <HiveMap
      payload={fixturePayload(now, items !== undefined ? { items } : {})}
      now={now}
    />
  );
}
