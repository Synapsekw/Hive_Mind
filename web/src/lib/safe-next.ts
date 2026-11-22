// Only same-site paths are allowed as a post-sign-in destination.
export function safeNext(value: string | null): string {
  if (!value) return "/";
  if (!value.startsWith("/")) return "/";
  if (value.startsWith("//") || value.includes("\\")) return "/";
  // Control characters (tabs and newlines are stripped by browsers, which can turn "/\t/x" into "//x").
  if (/[\u0000-\u001f\u007f]/.test(value)) return "/";
  return value;
}
