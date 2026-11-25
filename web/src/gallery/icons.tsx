// The gallery's drawn glyphs and the sharing dot. Decoration only (aria-hidden): every control
// that carries one is named in words.
import type { GalleryFile } from "./types";
import s from "./gallery.module.css";

/** The dot beside the sharing line: hollow, filled or half, so the words never stand alone. */
export function SharingMark({ file }: { file: GalleryFile }) {
  return (
    <span aria-hidden="true" className={s.mark} data-sharing={file.sharing} />
  );
}

const STROKE = {
  width: 16,
  height: 16,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

export function Cross({ small = false }: { small?: boolean }) {
  return (
    <svg
      aria-hidden="true"
      {...STROKE}
      width={small ? 12 : 16}
      height={small ? 12 : 16}
    >
      <path d="m4 4 8 8M12 4l-8 8" />
    </svg>
  );
}

export function Chevron({ back = false }: { back?: boolean }) {
  return (
    <svg aria-hidden="true" {...STROKE}>
      <path d={back ? "M10 3.5 5.5 8l4.5 4.5" : "m6 3.5 4.5 4.5L6 12.5"} />
    </svg>
  );
}

/** A small downward caret for a chip that opens a list. */
export function Caret() {
  return (
    <svg aria-hidden="true" {...STROKE} width={12} height={12}>
      <path d="m4.5 6.5 3.5 3.5 3.5-3.5" />
    </svg>
  );
}

/** Three dots: a folder's menu. */
export function More() {
  return (
    <svg aria-hidden="true" {...STROKE} width={14} height={14}>
      <path d="M3.5 8h.01M8 8h.01M12.5 8h.01" strokeWidth={2.2} />
    </svg>
  );
}
