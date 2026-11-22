// The workspace tabs and "Shared with me". Tabs are links: switching loads that tab's index.
import Link from "next/link";
import type { VaultData } from "./types";
import s from "./vault.module.css";

export function Tabs({
  data,
  hrefWorkspace,
  hrefShared,
}: {
  data: VaultData;
  hrefWorkspace: (id: string) => string;
  hrefShared: string;
}) {
  const tab = data.tab;
  return (
    <nav aria-label="Workspaces" className={s.tabs}>
      {data.workspaces.map((w) => {
        const on = tab.kind === "workspace" && tab.id === w.id;
        return (
          <Link
            key={w.id}
            href={hrefWorkspace(w.id)}
            prefetch={false}
            aria-current={on ? "page" : undefined}
            className={s.tab}
          >
            {w.name}
          </Link>
        );
      })}
      <Link
        href={hrefShared}
        prefetch={false}
        aria-current={tab.kind === "shared" ? "page" : undefined}
        className={s.tab}
      >
        Shared with me
      </Link>
    </nav>
  );
}
