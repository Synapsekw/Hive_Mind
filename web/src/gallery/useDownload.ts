"use client";

import { useRef } from "react";
import type { GalleryActions } from "./types";

/**
 * Asks the server for a download link and hands it to the browser. The link carries the
 * download disposition, so the page stays where it is. Answers false when there is no link.
 */
export function useDownload(
  downloadFile: GalleryActions["downloadFile"],
  id: string,
): () => Promise<boolean> {
  const busy = useRef(false);
  return async () => {
    if (busy.current) return true;
    busy.current = true;
    let link: { url: string } | null = null;
    try {
      link = await downloadFile(id);
    } catch {
      link = null;
    }
    busy.current = false;
    if (!link) return false;
    window.location.assign(link.url);
    return true;
  };
}
