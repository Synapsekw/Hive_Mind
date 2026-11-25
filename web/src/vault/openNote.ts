// Which note the preview shows, held on the client: a click asks the server for that one note
// (`openNote`) and the list stays as it is. Answers can come back out of order; only the answer
// to the latest request is shown. The server's own render (a cold load, or a re-read after a
// change) is taken as it comes, unless the person has since asked for another note.
import type { OpenAnswer, VaultData } from "./types";

export type OpenState = {
  /** The id of the latest request. */
  seq: number;
  /** The note id the address names, as far as this screen knows. */
  wanted: string | null;
  /** What the preview shows. */
  open: VaultData["open"];
  /** A request is on its way. */
  pending: boolean;
  /** The latest request failed; the preview keeps what it showed. */
  failed: boolean;
};

export type OpenEvent =
  | { type: "request"; id: string | null; seq: number }
  | { type: "answer"; seq: number; result: OpenAnswer }
  /** The server rendered the page again and sent this open note. */
  | { type: "served"; open: VaultData["open"] };

const idOf = (open: VaultData["open"]) =>
  open && "note" in open ? open.note.id : null;

/** The state a server render starts with. */
export function openFrom(open: VaultData["open"]): OpenState {
  return { seq: 0, wanted: idOf(open), open, pending: false, failed: false };
}

export function reduceOpen(s: OpenState, e: OpenEvent): OpenState {
  switch (e.type) {
    case "request":
      if (e.id === null)
        return {
          seq: e.seq,
          wanted: null,
          open: null,
          pending: false,
          failed: false,
        };
      return { ...s, seq: e.seq, wanted: e.id, pending: true, failed: false };
    case "answer":
      // An answer to an older request, or one the server's render has already overtaken.
      if (e.seq !== s.seq || !s.pending) return s;
      if (!e.result.ok) return { ...s, pending: false, failed: true };
      return { ...s, open: e.result.open, pending: false, failed: false };
    case "served": {
      const id = idOf(e.open);
      // A render that started before the person asked for another note.
      if (s.pending && id !== s.wanted) return s;
      // A render with no note keeps the one asked for: it may be the very note a delete has
      // just removed, and the delete still has to know it was the open one.
      return {
        ...s,
        wanted: id ?? s.wanted,
        open: e.open,
        pending: false,
        failed: false,
      };
    }
  }
}

/**
 * The note a link opens on this screen, or null when the click is not one to take over: not a
 * plain left click, a link that opens elsewhere, another page, or an address with no note.
 */
export function noteOfClick(
  click: {
    button: number;
    metaKey: boolean;
    ctrlKey: boolean;
    shiftKey: boolean;
    altKey: boolean;
  },
  link: { href: string; target: string; hasAttribute(name: string): boolean },
  here: { href: string; pathname: string },
): string | null {
  if (click.button !== 0) return null;
  if (click.metaKey || click.ctrlKey || click.shiftKey || click.altKey)
    return null;
  if ((link.target && link.target !== "_self") || link.hasAttribute("download"))
    return null;
  const to = new URL(link.href, here.href);
  const from = new URL(here.href);
  if (to.origin !== from.origin || to.pathname !== here.pathname) return null;
  return to.searchParams.get("note");
}
