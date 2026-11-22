import { notFound } from "next/navigation";
import { fixturePayload } from "../../../map/fixture";
import { HiveMap } from "../../../map/Map";

// A development page: the map over the built-in fixture hive. Never served in production.
export default function DevMapPage() {
  if (process.env.NODE_ENV === "production") notFound();
  const now = Date.now();
  return <HiveMap payload={fixturePayload(now)} now={now} />;
}
