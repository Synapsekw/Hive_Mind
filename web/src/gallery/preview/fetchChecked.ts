// Fetches a file for a preview and refuses anything that is not what it claims. The declared
// type was set by whoever saved the file, so it is never enough: a PDF must start with "%PDF-",
// text and CSV must not come back as HTML or SVG, and nothing is shown past its cap (text is cut,
// PDFs are refused).
import type { Kind } from "../types";

export type Checked =
  { ok: true; blob: Blob } | { ok: false; reason: "type" | "size" | "network" };

const ALLOWED: Partial<Record<Kind, string[]>> = {
  pdf: ["application/pdf"],
  text: ["text/plain", "text/markdown"],
  csv: ["text/csv", "text/plain"],
};

export async function fetchChecked(
  url: string,
  kind: Kind,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<Checked> {
  const allowed = ALLOWED[kind];
  if (!allowed) return { ok: false, reason: "type" };
  let res: Response;
  try {
    res = await fetch(url, {
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal,
    });
  } catch {
    return { ok: false, reason: "network" };
  }
  if (!res.ok) return { ok: false, reason: "network" };
  const type = (res.headers.get("content-type") ?? "")
    .split(";")[0]!
    .trim()
    .toLowerCase();
  if (!allowed.includes(type)) return { ok: false, reason: "type" };
  // A PDF that says it is too large is refused before its bytes are read.
  const length = Number(res.headers.get("content-length"));
  if (kind === "pdf" && Number.isFinite(length) && length > maxBytes)
    return { ok: false, reason: "size" };
  let blob: Blob;
  try {
    blob = await res.blob();
  } catch {
    return { ok: false, reason: "network" };
  }
  if (kind === "pdf") {
    if (blob.size > maxBytes) return { ok: false, reason: "size" };
    const head = new TextDecoder().decode(await blob.slice(0, 5).arrayBuffer());
    if (head !== "%PDF-") return { ok: false, reason: "type" };
    return { ok: true, blob: new Blob([blob], { type: "application/pdf" }) };
  }
  return { ok: true, blob: blob.slice(0, maxBytes, "text/plain") };
}
