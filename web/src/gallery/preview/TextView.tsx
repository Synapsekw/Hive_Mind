"use client";

// A text or Markdown file as plain text: decoded and put in a <pre> as a text node, so markup
// inside it is shown as written and never interpreted.
import { useEffect, useState } from "react";
import { sizeText } from "../text";
import { TEXT_VIEW_MAX } from "../kind";
import p from "./preview.module.css";

/** Decodes a Blob as UTF-8; a character cut at the cap becomes one replacement mark. */
export function useText(blob: Blob): string | null {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    blob.arrayBuffer().then(
      (buf) => live && setText(new TextDecoder("utf-8").decode(buf)),
      () => live && setText(""),
    );
    return () => {
      live = false;
    };
  }, [blob]);
  return text;
}

export function TextView({
  blob,
  truncated,
  name,
}: {
  blob: Blob;
  truncated: boolean;
  name: string;
}) {
  const text = useText(blob);
  if (text === null)
    return (
      <p role="status" className={p.note}>
        Opening…
      </p>
    );
  return (
    <div className={p.sheetWrap}>
      {truncated && (
        <p role="status" className={p.cut}>
          Showing the first {sizeText(TEXT_VIEW_MAX)}.
        </p>
      )}
      <pre className={p.text} tabIndex={0} aria-label={name}>
        {text}
      </pre>
    </div>
  );
}
