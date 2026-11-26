import { createServerSupabase } from "../../lib/supabase/server";
import { Settings } from "../../settings/Settings";
import { tabFromParam } from "../../settings/tabs";
import { Notice } from "../../shell/Notice";
import { cancelHiveDeletion, requestHiveDeletion } from "../hives/actions";
import { loadInboxCount } from "../inbox/load-inbox";
import {
  createAgent,
  createSyncKey,
  deleteTopic,
  deleteWorkspace,
  inviteMember,
  resendInvitation,
  revokeAgent,
  revokeInvitation,
  revokeSyncKey,
  saveTopics,
  scanTopics,
} from "./actions";
import { loadSettings } from "./load-settings";

// Reads the session cookie, so never prerendered.
export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const q = await searchParams;
  const asked = Array.isArray(q.tab) ? q.tab[0] : q.tab;
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
      tab={tabFromParam(asked, result.data.isOwner)}
      inbox={inbox}
      deletion={result.deletion}
      closing={result.closing}
      actions={{
        createAgent,
        revokeAgent,
        createSyncKey,
        revokeSyncKey,
        inviteMember: inviteMember.bind(null, result.hiveId),
        revokeInvitation,
        resendInvitation,
        // Bound to the hive this page shows, as inviting is.
        requestHiveDeletion: requestHiveDeletion.bind(null, result.hiveId),
        cancelHiveDeletion: cancelHiveDeletion.bind(null, result.hiveId),
        deleteWorkspace,
        scanTopics,
        saveTopics: saveTopics.bind(null, result.hiveId),
        deleteTopic,
      }}
    />
  );
}
