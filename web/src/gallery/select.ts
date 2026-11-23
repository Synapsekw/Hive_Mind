// Which of the loaded files the grid shows. Pure, so the tabs and the filter make no request.
import { PDF_VIEW_MAX } from "./kind";
import type { GalleryFile, Tab } from "./types";

function onTab(f: GalleryFile, tab: Tab): boolean {
  return tab === "all" || (tab === "mine" ? f.mine : !f.mine);
}

/** The files of a tab whose name contains the filter (trimmed, any case), in the order given. */
export function visibleFiles(
  files: GalleryFile[],
  tab: Tab,
  filter: string,
): GalleryFile[] {
  const needle = filter.trim().toLowerCase();
  return files.filter(
    (f) => onTab(f, tab) && f.name.toLowerCase().includes(needle),
  );
}

/** How many of the loaded files each tab holds, whatever the filter. */
export function tabCounts(files: GalleryFile[]): Record<Tab, number> {
  const mine = files.filter((f) => f.mine).length;
  return { mine, shared: files.length - mine, all: files.length };
}

/** Mine when the person has a file of their own, else All. */
export function defaultTab(files: GalleryFile[]): Tab {
  return files.some((f) => f.mine) ? "mine" : "all";
}

/** Whether the viewer can show the file: an image, or a PDF up to `PDF_VIEW_MAX`. */
export function viewable(f: GalleryFile): boolean {
  return f.kind === "image" || (f.kind === "pdf" && f.size <= PDF_VIEW_MAX);
}
