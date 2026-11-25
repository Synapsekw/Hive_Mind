// The note's text without a first heading that only repeats its title: the pane shows the
// title already. Only a level-one heading on the first line that has text is dropped.
const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

export function withoutTitle(body: string, title: string): string {
  const m = /^(?:[ \t]*\r?\n)*#[ \t]+([^\n]*?)[ \t]*(?:\r?\n|$)/.exec(body);
  if (!m || norm(m[1]!) !== norm(title)) return body;
  return body.slice(m[0].length);
}
