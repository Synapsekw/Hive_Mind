// What a file is, for showing it. Mirrors public.file_kind in the file_links migration; both are
// tested against tests/fixtures/kind-cases.json. The loader reads the stored column; this is for
// the fixture and the upload dialog's preview of what a file will be.
import type { Kind } from "./types";

export const THUMB_MAX = 2 * 1024 * 1024;
export const PDF_THUMB_MAX = 5 * 1024 * 1024;
export const PDF_VIEW_MAX = 25 * 1024 * 1024;
export const TEXT_VIEW_MAX = 512 * 1024;

export const KIND_LABEL: Record<Kind, string> = {
  pdf: "PDF",
  image: "Images",
  slides: "Slides",
  sheet: "Sheets",
  doc: "Documents",
  text: "Text",
  csv: "CSV",
  other: "Other",
};

/** Kinds whose declared type must agree with the extension. */
const CHECKED = new Map<string, [Kind, string[]]>([
  ["png", ["image", ["image/png"]]],
  ["jpg", ["image", ["image/jpeg"]]],
  ["jpeg", ["image", ["image/jpeg"]]],
  ["gif", ["image", ["image/gif"]]],
  ["webp", ["image", ["image/webp"]]],
  ["avif", ["image", ["image/avif"]]],
  ["pdf", ["pdf", ["application/pdf"]]],
  ["md", ["text", ["text/markdown", "text/plain"]]],
  ["txt", ["text", ["text/markdown", "text/plain"]]],
  ["csv", ["csv", ["text/csv", "text/plain"]]],
]);
/** Kinds only ever downloaded: the extension alone decides. */
const BY_NAME = new Map<string, Kind>([
  ["pptx", "slides"],
  ["xlsx", "sheet"],
  ["docx", "doc"],
]);

function extension(name: string): string {
  const m = /\.([^./]+)$/.exec(name);
  return m ? m[1]!.toLowerCase() : "";
}

export function fileKind(name: string, mime: string | null): Kind {
  const ext = extension(name);
  const checked = CHECKED.get(ext);
  if (checked) {
    const declared = (mime ?? "").split(";")[0]!.trim().toLowerCase();
    return checked[1].includes(declared) ? checked[0] : "other";
  }
  return BY_NAME.get(ext) ?? "other";
}

export function kindLabel(kind: Kind, name: string): string {
  if (kind === "pdf") return "PDF";
  const ext = extension(name);
  return /^[a-z0-9]{1,5}$/.test(ext) ? ext.toUpperCase() : "FILE";
}
