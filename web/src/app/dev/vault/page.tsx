import { notFound } from "next/navigation";
import { fixtureVault } from "../../../vault/fixture";
import { DevVault } from "./DevVault";

// A development page: the vault over the built-in fixture. Never served in production.
// A fixed clock keeps every render, and so every test and screenshot, the same.
const NOW = Date.UTC(2026, 10, 22, 12, 0, 0);

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function DevVaultPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const q = await searchParams;
  const data = fixtureVault(NOW, {
    ws: one(q.ws),
    tab: one(q.tab),
    note: one(q.note),
  });
  return <DevVault data={data} now={NOW} fail={one(q.fail) === "1"} />;
}
