import { createServerSupabase } from "../../lib/supabase/server";
import { Settings } from "../../settings/Settings";
import { Notice } from "../../shell/Notice";
import { loadInboxCount } from "../inbox/load-inbox";
import { addMember, createAgent, revokeAgent } from "./actions";
import { loadSettings } from "./load-settings";

// Reads the session cookie, so never prerendered.
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const db = await createServerSupabase();
  const now = Date.now();
  const [result, inbox] = await Promise.all([
    loadSettings(db, now),
    loadInboxCount(db),
  ]);

  if (result.state === "no-hive") {
    return (
      <Notice current="settings">
        You&apos;re not in a hive yet. Ask its owner to invite you.
      </Notice>
    );
  }
  if (result.state === "error") {
    return (
      <Notice current="settings" tryAgain>
        Couldn&apos;t load the settings.
      </Notice>
    );
  }
  return (
    <Settings
      data={result.data}
      now={now}
      inbox={inbox}
      actions={{ createAgent, revokeAgent, addMember }}
    />
  );
}
