import { Notice } from "../../shell/Notice";
import { createServerSupabase } from "../../lib/supabase/server";
import { Vault } from "../../vault/Vault";
import { loadInboxCount } from "../inbox/load-inbox";
import { preview, release, saveFolder, saveNote } from "./actions";
import { loadVault } from "./load-vault";

// Reads the session cookie, so never prerendered.
export const dynamic = "force-dynamic";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function VaultPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const q = await searchParams;
  const db = await createServerSupabase();
  const [result, inbox] = await Promise.all([
    loadVault(db, {
      ws: one(q.ws),
      tab: one(q.tab),
      note: one(q.note),
    }),
    loadInboxCount(db),
  ]);

  if (result.state === "no-hive") {
    return (
      <Notice current="vault">
        You&apos;re not in a hive yet. Ask its owner to invite you.
      </Notice>
    );
  }
  if (result.state === "error") {
    return (
      <Notice current="vault" tryAgain>
        Couldn&apos;t load the hive.
      </Notice>
    );
  }
  return (
    <Vault
      data={result.data}
      now={Date.now()}
      actions={{ saveNote, saveFolder, release, preview }}
      inbox={inbox}
    />
  );
}
