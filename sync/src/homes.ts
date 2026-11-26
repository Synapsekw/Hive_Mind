// Which note a file lives in: the first note, in path order, that links to it (`![[name]]`,
// `[[name]]` or a relative markdown link); with none, the "Vault files" note of its folder,
// which exists in the app only. A target names a file by its relative path, its path from the
// vault's root, the end of its path, or its bare name; a bare name two files share means the
// one in the note's own folder, else the one with the shortest path.
export const VAULT_FILES = "Vault files.md";

const dirOf = (p: string): string =>
  p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
const fold = (p: string): string => p.normalize("NFC").toLowerCase();

export function vaultFilesNote(filePath: string): string {
  const dir = dirOf(filePath);
  return dir ? `${dir}/${VAULT_FILES}` : VAULT_FILES;
}

function resolve(base: string, rel: string): string | null {
  const parts = base ? base.split("/") : [];
  for (const part of rel.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.pop() === undefined) return null;
    } else parts.push(part);
  }
  return parts.join("/");
}

export function chooseHomes(
  notes: { path: string; targets: string[] }[],
  files: string[],
): Map<string, string> {
  const byPath = new Map<string, string>();
  const byName = new Map<string, string[]>();
  for (const f of files) {
    byPath.set(fold(f), f);
    const name = fold(f.slice(f.lastIndexOf("/") + 1));
    byName.set(name, [...(byName.get(name) ?? []), f]);
  }
  const find = (notePath: string, target: string): string | null => {
    const t = target.trim();
    if (!t) return null;
    const dir = dirOf(notePath);
    if (t.startsWith("./") || t.startsWith("../")) {
      const r = resolve(dir, t);
      return r === null ? null : (byPath.get(fold(r)) ?? null);
    }
    const exact = byPath.get(fold(t.replace(/^\/+/, "")));
    if (exact) return exact;
    const near = byPath.get(fold(dir ? `${dir}/${t}` : t));
    if (near) return near;
    if (t.includes("/")) {
      const end = fold(`/${t}`);
      const hits = files.filter((f) => fold(`/${f}`).endsWith(end));
      return (
        hits.sort((a, b) => a.length - b.length || (a < b ? -1 : 1))[0] ?? null
      );
    }
    const named = byName.get(fold(t)) ?? [];
    const here = named.filter((f) => dirOf(f) === dir);
    const pool = here.length ? here : named;
    return (
      [...pool].sort((a, b) => a.length - b.length || (a < b ? -1 : 1))[0] ??
      null
    );
  };

  const homes = new Map<string, string>();
  for (const note of [...notes].sort((a, b) => (a.path < b.path ? -1 : 1))) {
    for (const target of note.targets) {
      const file = find(note.path, target);
      if (file && !homes.has(file)) homes.set(file, note.path);
    }
  }
  for (const f of files) if (!homes.has(f)) homes.set(f, vaultFilesNote(f));
  return homes;
}
