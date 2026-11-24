// The declared type of an uploaded file, decided on the server from its name (never from what
// the browser says). The same table the stdio MCP server uses, plus three image types.
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
  svg: "image/svg+xml",
  csv: "text/csv",
  txt: "text/plain",
  md: "text/markdown",
  html: "text/html",
  json: "application/json",
  zip: "application/zip",
};

export function mimeFor(name: string): string {
  const m = /\.([^./]+)$/.exec(name);
  return (m && MIME[m[1]!.toLowerCase()]) || "application/octet-stream";
}
