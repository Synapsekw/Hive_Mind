// The folder column: "All notes", the folder tree with counts and rule marks, and "Held" when
// the workspace has held notes. Choosing and opening folders is client state only.
import { folderMark } from "./marks";
import { Glyph, markText } from "./MarkTag";
import { folderSharing, HELD_ROW } from "./sentences";
import { isShown, type Scope, type TreeNode } from "./tree";
import type { VaultData } from "./types";
import s from "./vault.module.css";

type Props = {
  root: TreeNode;
  scope: Scope;
  opened: Set<string>;
  held: number;
  members: VaultData["members"];
  onScope: (scope: Scope) => void;
  onToggle: (path: string) => void;
};

function Folder({
  node,
  depth,
  ...p
}: Props & { node: TreeNode; depth: number }) {
  const isOpen = p.opened.has(node.path);
  const chosen = p.scope.kind === "folder" && p.scope.path === node.path;
  const mark = folderMark(node.rule, p.members);
  const kids = node.children.filter(isShown);
  const hasChildren = kids.length > 0;
  return (
    <li>
      <div className={s.folderRow} style={{ paddingLeft: depth * 14 }}>
        {hasChildren ? (
          <button
            type="button"
            className={s.disclose}
            aria-expanded={isOpen}
            aria-label={`Folders in ${node.name}`}
            onClick={() => p.onToggle(node.path)}
          >
            <span
              aria-hidden="true"
              className={s.caret}
              data-open={isOpen || undefined}
            />
          </button>
        ) : (
          <span className={s.discloseSpace} />
        )}
        <button
          type="button"
          className={s.folder}
          aria-pressed={chosen}
          onClick={() => p.onScope({ kind: "folder", path: node.path })}
        >
          <span className={s.folderName} title={node.path}>
            {node.name}
          </span>
          {mark && (
            <span
              className={s.folderMark}
              title={folderSharing(markText(mark))}
            >
              <Glyph kind={mark.kind} />
              <span className={s.srOnly}>{folderSharing(markText(mark))}</span>
            </span>
          )}
          <span className={s.folderCount}>{node.count}</span>
        </button>
      </div>
      {hasChildren && isOpen && (
        <ul className={s.tree}>
          {kids.map((c) => (
            <Folder key={c.path} {...p} node={c} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function Folders(p: Props) {
  return (
    <nav aria-label="Folders">
      <ul className={s.tree}>
        <li>
          <div className={s.folderRow}>
            <span className={s.discloseSpace} />
            <button
              type="button"
              className={s.folder}
              aria-pressed={p.scope.kind === "all"}
              onClick={() => p.onScope({ kind: "all" })}
            >
              <span className={s.folderName}>All notes</span>
              <span className={s.folderCount}>{p.root.count}</span>
            </button>
          </div>
        </li>
        {p.root.children.filter(isShown).map((c) => (
          <Folder key={c.path} {...p} node={c} depth={0} />
        ))}
        {p.held > 0 && (
          <li className={s.heldItem}>
            <div className={s.folderRow}>
              <span className={s.discloseSpace} />
              <button
                type="button"
                className={s.folder}
                aria-pressed={p.scope.kind === "held"}
                onClick={() => p.onScope({ kind: "held" })}
              >
                <span className={`${s.folderName} ${s.heldName}`}>
                  {HELD_ROW}
                </span>
                <span className={`${s.folderCount} ${s.heldName}`}>
                  {p.held}
                </span>
              </button>
            </div>
          </li>
        )}
      </ul>
    </nav>
  );
}
