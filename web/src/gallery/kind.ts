// What a file is, for the purpose of showing it. The declared type is whatever the saving agent
// said, so it is never trusted alone: a file is an image or a PDF only when its name's extension
// and its declared type agree. SVG and HTML are not in the table, so they are always `other` and
// are never shown inline.
import type { Kind } from "./types";

/** Images larger than this get no thumbnail. */
export const THUMB_MAX = 2 * 1024 * 1024;
/** PDFs larger than this are offered for download, not shown in the viewer. */
export const PDF_VIEW_MAX = 25 * 1024 * 1024;

/** Kinds the viewer can show: the extension and the one declared type it must come with. */
const SHOWN = new Map<string, ["image" | "pdf", string]>([
  ["png", ["image", "image/png"]],
  ["jpg", ["image", "image/jpeg"]],
  ["jpeg", ["image", "image/jpeg"]],
  ["gif", ["image", "image/gif"]],
  ["webp", ["image", "image/webp"]],
  ["avif", ["image", "image/avif"]],
  ["pdf", ["pdf", "application/pdf"]],
]);

/** Kinds that are only ever downloaded, so the extension alone decides. */
const BY_NAME = new Map<string, Kind>([
  ["pptx", "slides"],
  ["xlsx", "sheet"],
  ["csv", "sheet"],
  ["docx", "doc"],
  ["md", "doc"],
  ["txt", "doc"],
]);

/** The text after the last dot, lower-cased; "" when the name has no dot. */
function extension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

export function fileKind(name: string, mime: string | null): Kind {
  const ext = extension(name);
  const shown = SHOWN.get(ext);
  if (shown) {
    const declared = (mime ?? "").split(";")[0]!.trim().toLowerCase();
    return declared === shown[1] ? shown[0] : "other";
  }
  return BY_NAME.get(ext) ?? "other";
}

/**
 * The short label on a file's tile: its extension in capitals ("PDF", "PNG", "PPTX"), or "FILE"
 * when the name has none that is 1 to 5 letters and digits.
 */
export function kindLabel(kind: Kind, name: string): string {
  if (kind === "pdf") return "PDF";
  const ext = extension(name);
  return /^[a-z0-9]{1,5}$/.test(ext) ? ext.toUpperCase() : "FILE";
}
