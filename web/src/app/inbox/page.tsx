import { Inbox } from "../../inbox/Inbox";
import { createServerSupabase } from "../../lib/supabase/server";
import { Notice } from "../../shell/Notice";
import { noteOpening, releaseNote, respondToLink } from "./actions";
import { loadInbox } from "./load-inbox";

// Reads the session cookie, so never prerendered.
export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const result = await loadInbox(await createServerSupabase());

  if (result.state === "no-hive") {
    return (
      <Notice current="inbox">
        You&apos;re not in a hive yet. Ask its owner to invite you.
      </Notice>
    );
  }
  if (result.state === "error") {
    return (
      <Notice current="inbox" tryAgain>
        Couldn&apos;t load the inbox.
      </Notice>
    );
  }
  return (
    <Inbox
      data={result.data}
      now={Date.now()}
      actions={{ respondToLink, releaseNote, noteOpening }}
    />
  );
}
