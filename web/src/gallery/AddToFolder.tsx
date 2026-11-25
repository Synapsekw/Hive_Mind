"use client";

// "Add to folder": a button and a list of the person's folders with a check on those that hold
// the file. Ticking one adds the file there, unticking takes it out; the screen asks the server
// and updates the folders when it agrees. Used in the file panel and the viewer's bar.
import { useState } from "react";
import { folderPath } from "./text";
import { usePopover } from "./usePopover";
import type { GalleryFolder } from "./types";
import s from "./gallery.module.css";

export function AddToFolder({
  folders,
  holding,
  onToggle,
}: {
  /** In tree order. */
  folders: GalleryFolder[];
  /** Ids of the folders that hold the file now. */
  holding: Set<string>;
  onToggle(folderId: string, on: boolean): Promise<boolean>;
}) {
  const pop = usePopover();
  const [said, setSaid] = useState<string | null>(null);
  // A tick shows at once; it settles to the folders' real state when the server answers.
  const [pending, setPending] = useState<Map<string, boolean>>(new Map());
  const mark = (id: string, on: boolean | null) =>
    setPending((m) => {
      const next = new Map(m);
      if (on === null) next.delete(id);
      else next.set(id, on);
      return next;
    });
  return (
    <div ref={pop.wrap} className={s.menuWrap} onKeyDown={pop.onKeyDown}>
      <button
        ref={pop.trigger}
        type="button"
        className={s.secondary}
        aria-expanded={pop.open}
        onClick={() => {
          setSaid(null);
          pop.setOpen(!pop.open);
        }}
      >
        Add to folder
      </button>
      {pop.open && (
        <div
          role="group"
          aria-label="Folders"
          className={s.popover}
          data-end=""
        >
          {folders.length === 0 && (
            <p className={s.popNote}>
              No folders yet. Make one with “New folder” on the left.
            </p>
          )}
          {folders.map((f) => (
            <label key={f.id} className={s.popItem}>
              <input
                type="checkbox"
                checked={pending.get(f.id) ?? holding.has(f.id)}
                onChange={async (e) => {
                  const on = e.currentTarget.checked;
                  mark(f.id, on);
                  const ok = await onToggle(f.id, on);
                  mark(f.id, null);
                  setSaid(ok ? null : "Couldn't change the folder.");
                }}
              />
              {folderPath(f.id, folders)}
            </label>
          ))}
          {said && (
            <p role="alert" className={s.refused}>
              {said}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
