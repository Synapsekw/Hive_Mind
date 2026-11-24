import { notFound } from "next/navigation";
import { fixtureVault } from "../../../vault/fixture";
import { DevVault } from "./DevVault";

// A development page: the vault over the built-in fixture. Never served in production.
//   ?fail=1   every write is refused
//   ?slow=1   deleting a note or ending a link takes over a second; an import batch most of one
//   ?failbatch=2    the import's second batch is refused (any number, or "all")
//   ?failconnect=2  the second step of connecting wiki links is refused (any number, or "all")
//   ?failattach=2   the second step of attaching topics is refused (any number, or "all")
//   ?notopics=1     the hive has no topics: attaching finds nothing to attach to
//   ?taken=1  a new workspace is refused: the name is in use
//   ?limit=1  a new workspace is refused: the person has 20 already
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
      importFlags={{
        failbatch: one(q.failbatch) ?? null,
        failconnect: one(q.failconnect) ?? null,
        failattach: one(q.failattach) ?? null,
        notopics: one(q.notopics) === "1",
        taken: one(q.taken) === "1",
        limit: one(q.limit) === "1",
      }}
    />
  );
}
