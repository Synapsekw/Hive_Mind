import { notFound } from "next/navigation";
import { fixtureVault } from "../../../vault/fixture";
import { DevVault } from "./DevVault";

// A development page: the vault over the built-in fixture. Never served in production.
//   ?fail=1   every write is refused
//   ?slow=1   deleting a note takes over a second
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
  const query = { ws: one(q.ws), tab: one(q.tab), note: one(q.note) };
  let data = fixtureVault(NOW, query);
  // As the real page does it: the open note decides the tab. A colleague's opens "Shared with
  // me", one's own opens its workspace, whatever else the address says.
  const note = data.open && "note" in data.open ? data.open.note : null;
  if (note)
    data = fixtureVault(
      NOW,
      note.member_id === data.me
        ? { note: query.note, ws: note.workspace_id }
        : { note: query.note, tab: "shared" },
    );
  return (
    <DevVault
      data={data}
      now={NOW}
      fail={one(q.fail) === "1"}
      slow={one(q.slow) === "1"}
    />
  );
}
