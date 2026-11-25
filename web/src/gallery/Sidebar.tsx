"use client";

// The gallery's left column: the three scopes with their counts, then the person's own folders
// (two levels), each a filter and a drop target for a dragged card. Choosing a scope or a folder
// is a filter, so it loads nothing; creating, renaming and deleting a folder go through the
// screen's callbacks, which ask the server. Folders are the person's alone: nobody else sees
// them, and deleting one leaves its files in the gallery.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { DRAG_TYPE } from "./FileCard";
import { More } from "./icons";
import { usePopover } from "./usePopover";
import type { GalleryFolder, Scope } from "./types";
import s from "./gallery.module.css";

const SCOPES: { key: Scope; label: string }[] = [
  { key: "all", label: "All files" },
  { key: "mine", label: "Mine" },
  { key: "shared", label: "Shared with me" },
];

type Tree = { folder: GalleryFolder; children: GalleryFolder[] }[];

export type SidebarProps = {
  counts: Record<Scope, number>;
  scope: Scope;
  folder: string | null;
  tree: Tree;
  folderCounts: Map<string, number>;
  onScope(scope: Scope): void;
  onFolder(id: string): void;
  onCreate(name: string, parentId: string | null): Promise<boolean>;
  onRename(id: string, name: string): Promise<boolean>;
  onDelete(id: string): Promise<boolean>;
  onDropFile(folderId: string, fileId: string): void;
};

/** An inline name field: Enter saves, Escape (or leaving it empty) cancels. */
function NameField({
  initial,
  onSave,
  onCancel,
}: {
  initial: string;
  onSave(name: string): void;
  onCancel(): void;
}) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  return (
    <input
      ref={input}
      type="text"
      aria-label="Folder name"
      className={s.nameField}
      defaultValue={initial}
      maxLength={80}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onCancel();
        } else if (e.key === "Enter") {
          e.preventDefault();
          const name = e.currentTarget.value.trim();
          if (name) onSave(name);
          else onCancel();
        }
      }}
      onBlur={onCancel}
    />
  );
}

function FolderMenu({
  folder,
  topLevel,
  onRename,
  onSub,
  onDelete,
}: {
  folder: GalleryFolder;
  topLevel: boolean;
  onRename(): void;
  onSub(): void;
  onDelete(): void;
}) {
  const pop = usePopover();
  const choose = (run: () => void) => () => {
    pop.setOpen(false);
    run();
  };
  return (
    <div ref={pop.wrap} className={s.menuWrap} onKeyDown={pop.onKeyDown}>
      <button
        ref={pop.trigger}
        type="button"
        className={s.rowMore}
        aria-label={`More for ${folder.name}`}
        aria-expanded={pop.open}
        onClick={() => pop.setOpen(!pop.open)}
      >
        <More />
      </button>
      {pop.open && (
        <div
          role="group"
          aria-label={`${folder.name} folder`}
          className={s.menu}
        >
          <button
            type="button"
            className={s.menuItem}
            onClick={choose(onRename)}
          >
            Rename
          </button>
          {topLevel && (
            <button
              type="button"
              className={s.menuItem}
              onClick={choose(onSub)}
            >
              New sub-folder
            </button>
          )}
          <button
            type="button"
            className={s.menuItem}
            onClick={choose(onDelete)}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

export function Sidebar(props: SidebarProps) {
  const { counts, scope, folder: current, tree, folderCounts } = props;
  // Which folder is being named, renamed or asked about; one at a time.
  const [creating, setCreating] = useState<{ parent: string | null } | null>(
    null,
  );
  const [renaming, setRenaming] = useState<string | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const newButton = useRef<HTMLButtonElement>(null);

  async function create(name: string, parent: string | null) {
    setCreating(null);
    setSaid(
      (await props.onCreate(name, parent))
        ? null
        : "Couldn't create the folder.",
    );
  }
  async function rename(id: string, name: string) {
    setRenaming(null);
    setSaid(
      (await props.onRename(id, name)) ? null : "Couldn't rename the folder.",
    );
  }
  async function remove(id: string) {
    setAsking(null);
    setSaid((await props.onDelete(id)) ? null : "Couldn't delete the folder.");
  }

  const row = (f: GalleryFolder, topLevel: boolean): ReactNode => (
    <li key={f.id} className={s.folderItem}>
      {renaming === f.id ? (
        <NameField
          initial={f.name}
          onSave={(name) =>
            name === f.name ? setRenaming(null) : rename(f.id, name)
          }
          onCancel={() => setRenaming(null)}
        />
      ) : (
        <div className={s.row} data-sub={topLevel ? undefined : ""}>
          <button
            type="button"
            className={s.rowButton}
            aria-pressed={current === f.id}
            data-over={over === f.id || undefined}
            onClick={() => props.onFolder(f.id)}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
              setOver(f.id);
            }}
            onDragLeave={() => setOver((o) => (o === f.id ? null : o))}
            onDrop={(e) => {
              setOver(null);
              const id = e.dataTransfer.getData(DRAG_TYPE);
              if (!id) return;
              e.preventDefault();
              props.onDropFile(f.id, id);
            }}
          >
            <span className={s.rowName}>{f.name}</span>{" "}
            <span className={s.count}>{folderCounts.get(f.id) ?? 0}</span>
          </button>
          <FolderMenu
            folder={f}
            topLevel={topLevel}
            onRename={() => setRenaming(f.id)}
            onSub={() => setCreating({ parent: f.id })}
            onDelete={() => setAsking(f.id)}
          />
        </div>
      )}
      {asking === f.id && (
        <div className={s.ask} role="group" aria-label="Delete folder">
          <p>Delete this folder? Files stay in the gallery.</p>
          <div className={s.askButtons}>
            <button
              type="button"
              className={s.confirm}
              onClick={() => remove(f.id)}
            >
              Delete
            </button>
            <button
              type="button"
              className={s.secondary}
              autoFocus
              onClick={() => setAsking(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </li>
  );

  return (
    <nav aria-label="Gallery sidebar" className={s.side}>
      <div role="group" aria-label="Scope" className={s.rows}>
        {SCOPES.map((x) => (
          <button
            key={x.key}
            type="button"
            className={s.rowButton}
            aria-pressed={current === null && scope === x.key}
            onClick={() => props.onScope(x.key)}
          >
            <span className={s.rowName}>{x.label}</span>{" "}
            <span className={s.count}>{counts[x.key]}</span>
          </button>
        ))}
      </div>
      <div role="group" aria-labelledby="gallery-folders" className={s.folders}>
        <h2 id="gallery-folders" className={s.sideHead}>
          My folders
        </h2>
        <ul role="list" className={s.folderList}>
          {tree.map(({ folder, children }) => (
            <li key={folder.id} className={s.folderGroup}>
              <ul role="list" className={s.folderList}>
                {row(folder, true)}
                {children.map((c) => row(c, false))}
                {creating?.parent === folder.id && (
                  <li className={s.folderItem} data-sub="">
                    <NameField
                      initial=""
                      onSave={(name) => create(name, folder.id)}
                      onCancel={() => setCreating(null)}
                    />
                  </li>
                )}
              </ul>
            </li>
          ))}
          {creating?.parent === null && (
            <li className={s.folderItem}>
              <NameField
                initial=""
                onSave={(name) => create(name, null)}
                onCancel={() => {
                  setCreating(null);
                  newButton.current?.focus();
                }}
              />
            </li>
          )}
        </ul>
        <button
          ref={newButton}
          type="button"
          className={s.newFolder}
          onClick={() => setCreating({ parent: null })}
        >
          + New folder
        </button>
        {said && (
          <p role="alert" className={s.refused}>
            {said}
          </p>
        )}
      </div>
    </nav>
  );
}
