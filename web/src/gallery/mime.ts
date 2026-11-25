// The declared type of an uploaded file, decided on the server from its name (never from what
// the browser says). The stdio MCP server's table plus three image types, less every type a
// browser would render as a page: an upload named .html, .htm or .svg is stored and served as a
// plain byte stream (download only), so its storage link can never open as a live page.
const MIME: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  csv: "text/csv",
  txt: "text/plain",
  md: "text/markdown",
  json: "application/json",
  zip: "application/zip",
};

/** Types that would render as a page; never declared for an upload, whatever the table says. */
const PAGES = new Set([
  "text/html",
  "image/svg+xml",
  "application/xhtml+xml",
  "text/xml",
  "application/xml",
]);
const BYTES = "application/octet-stream";

export function mimeFor(name: string): string {
  const m = /\.([^./]+)$/.exec(name);
  const mime = (m && MIME[m[1]!.toLowerCase()]) || BYTES;
  return PAGES.has(mime) ? BYTES : mime;
}
