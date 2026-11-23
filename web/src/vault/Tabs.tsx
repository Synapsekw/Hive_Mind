// The workspace tabs and "Shared with me". Tabs are links: switching loads that tab's index.
"use client";
import { useRef } from "react";
import Link from "next/link";
import { useSlidingPill } from "../shell/useSlidingPill";
import pillCss from "../shell/SlidingPill.module.css";
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
  const group = useRef<HTMLElement>(null);
  const pill = useSlidingPill(
    group,
    '[aria-current="page"]',
    tab.kind === "workspace" ? tab.id : "shared",
  );
  return (
    <nav ref={group} aria-label="Workspaces" className={s.tabs}>
      <span aria-hidden="true" className={pillCss.pill} style={pill} />
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
