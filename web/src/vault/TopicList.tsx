// The topic column: "All notes", each kind that has notes as a disclosure with its count, opening
// to its topics, then "No topic". Choosing and opening are client state only. The folder column's
// rows and classes are reused.
import { NO_TOPICS } from "./attachText";
import { ALL_NOTES, BY_TOPICS, NO_TOPIC } from "./topicText";
import type { topicTree } from "./topicTree";
import type { Scope } from "./tree";
import s from "./vault.module.css";

type Props = {
  tree: ReturnType<typeof topicTree>;
  /** Notes in the open tab. */
  total: number;
  /** The hive has no topics at all. */
  hiveEmpty: boolean;
  scope: Scope;
  opened: ReadonlySet<string>;
  onScope: (scope: Scope) => void;
  onToggle: (kind: string) => void;
};

export function TopicList({ tree, total, hiveEmpty, ...p }: Props) {
  if (hiveEmpty)
    return (
      <nav aria-label={BY_TOPICS}>
        <p className={s.empty}>{NO_TOPICS}</p>
      </nav>
    );
  return (
    <nav aria-label={BY_TOPICS}>
      <ul className={s.tree}>
        <li>
          <div className={s.folderRow}>
            <button
              type="button"
              className={s.folder}
              aria-pressed={p.scope.kind === "all"}
              onClick={() => p.onScope({ kind: "all" })}
            >
              <span className={s.folderName}>{ALL_NOTES}</span>
              <span className={s.folderCount}>{total}</span>
            </button>
          </div>
        </li>
        {tree.kinds.map((k) => {
          const isOpen = p.opened.has(k.kind);
          return (
            <li key={k.kind}>
              <div className={s.folderRow}>
                <button
                  type="button"
                  className={s.folder}
                  aria-expanded={isOpen}
                  onClick={() => p.onToggle(k.kind)}
                >
                  <span
                    aria-hidden="true"
                    className={s.caret}
                    data-open={isOpen || undefined}
                  />
                  <span className={s.folderName}>{k.name}</span>
                  <span className={s.folderCount}>{k.count}</span>
                </button>
              </div>
              {isOpen && (
                <ul className={s.tree}>
                  {k.topics.map((t) => (
                    <li key={t.id}>
                      <div className={s.folderRow} style={{ paddingLeft: 22 }}>
                        <button
                          type="button"
                          className={s.folder}
                          aria-pressed={
                            p.scope.kind === "topic" && p.scope.id === t.id
                          }
                          onClick={() => p.onScope({ kind: "topic", id: t.id })}
                        >
                          <span className={s.folderName} title={t.name}>
                            {t.name}
                          </span>
                          <span className={s.folderCount}>{t.count}</span>
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
        {tree.none > 0 && (
          <li className={s.heldItem}>
            <div className={s.folderRow}>
              <button
                type="button"
                className={s.folder}
                aria-pressed={p.scope.kind === "untopiced"}
                onClick={() => p.onScope({ kind: "untopiced" })}
              >
                <span className={s.folderName}>{NO_TOPIC}</span>
                <span className={s.folderCount}>{tree.none}</span>
              </button>
            </div>
          </li>
        )}
      </ul>
    </nav>
  );
}
