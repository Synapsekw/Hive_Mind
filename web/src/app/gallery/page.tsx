import { Gallery } from "../../gallery/Gallery";
import { createServerSupabase } from "../../lib/supabase/server";
import { Notice } from "../../shell/Notice";
import { loadInboxCount } from "../inbox/load-inbox";
import {
  addToFolder,
  createFolder,
  deleteFile,
  deleteFolder,
  downloadFile,
  endUpload,
  findMyNotes,
  finishUpload,
  loadPage,
  openFile,
  removeFromFolder,
  renameFolder,
  setHome,
  startUpload,
} from "./actions";
import { loadGallery } from "./load-gallery";

// Reads the session cookie, so never prerendered.
export const dynamic = "force-dynamic";

export default async function GalleryPage() {
  const db = await createServerSupabase();
  const [result, inbox] = await Promise.all([
    loadGallery(db),
    loadInboxCount(db),
  ]);

  if (result.state === "no-hive") {
    return (
      <Notice current="gallery">
        You&apos;re not in a hive yet. Ask its owner to invite you.
      </Notice>
    );
  }
  if (result.state === "error") {
    return (
      <Notice current="gallery" tryAgain>
        Couldn&apos;t load the hive.
      </Notice>
    );
  }
  return (
    <Gallery
      data={result.data}
      now={Date.now()}
      actions={{
        openFile,
        downloadFile,
        deleteFile,
        loadPage,
        setHome,
        findMyNotes,
        createFolder,
        renameFolder,
        deleteFolder,
        addToFolder,
        removeFromFolder,
        startUpload,
        finishUpload,
        endUpload,
      }}
      inbox={inbox}
    />
  );
}
