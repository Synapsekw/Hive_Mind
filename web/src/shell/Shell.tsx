// The left rail, shared by the map, the vault, the gallery, the inbox and the settings: the mark,
// the hive's name (the switcher between the person's hives, with New hive), the destinations (Map, Vault, Gallery, Inbox with the number waiting, Settings), the agents when
// given (folded into one card) and the account menu (Appearance, Settings, sign out). It sits
// straight on the wash, so it is the "chrome" scope (white text in light mode).
"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { badge } from "../inbox/text";
import { AccountMenu } from "./AccountMenu";
import { AgentsCard } from "./AgentsCard";
import { useHiveActions, type HiveActions } from "./HiveActions";
import { HiveSwitcher } from "./HiveSwitcher";
import s from "./shell.module.css";

export type AgentRow = {
  id: string;
  /** The agent's own name for the caller's agents; "<member>, <provider>" for colleagues'. */
  name: string;
  status: string;
  connected: boolean;
  /** When the agent's token was last used; absent or null reads as "never". */
  lastUsedAt?: string | null;
};

const ICON = {
  width: 16,
  height: 16,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.3,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

const DESTINATIONS = [
  {
    key: "map",
    href: "/",
    name: "Map",
    icon: (
      <svg aria-hidden="true" {...ICON}>
        <circle cx="8" cy="8" r="2" />
        <circle cx="3" cy="3.5" r="1.2" />
        <circle cx="13" cy="4" r="1.2" />
        <circle cx="12" cy="13" r="1.2" />
        <path d="M6.6 6.6 3.9 4.3M9.6 6.9l2.5-2.1M9.2 9.6l2 2.5" />
      </svg>
    ),
  },
  {
    key: "vault",
    href: "/vault",
    name: "Vault",
    icon: (
      <svg aria-hidden="true" {...ICON}>
        <path d="M2 4.5h4l1.2 1.5H14v6.5H2z" />
      </svg>
    ),
  },
  {
    key: "gallery",
    href: "/gallery",
    name: "Gallery",
    icon: (
      <svg aria-hidden="true" {...ICON}>
        <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
        <path d="m2.5 11 3.2-3.2 2.6 2.6 2-2 3.2 3.2" />
        <circle cx="10.6" cy="5.8" r="1" />
      </svg>
    ),
  },
  {
    key: "inbox",
    href: "/inbox",
    name: "Inbox",
    icon: (
      <svg aria-hidden="true" {...ICON}>
        <path d="M2 9.5 4 3h8l2 6.5v3.5H2z" />
        <path d="M2 9.5h3.5l1 1.5h3l1-1.5H14" />
      </svg>
    ),
  },
  {
    key: "settings",
    href: "/settings",
    name: "Settings",
    icon: (
      <svg aria-hidden="true" {...ICON}>
        <path d="M2 4.5h5.5M10.5 4.5H14M2 11.5h2.5M7.5 11.5H14" />
        <circle cx="9" cy="4.5" r="1.5" />
        <circle cx="6" cy="11.5" r="1.5" />
      </svg>
    ),
  },
] as const;

export function Shell({
  current,
  agents = [],
  inbox,
  now: nowProp,
  hiveActions,
}: {
  current: "map" | "vault" | "gallery" | "inbox" | "settings";
  agents?: AgentRow[];
  /** How many links and held notes wait for the person; shown on the Inbox row. */
  inbox?: number;
  /** The page's own clock (the map passes its `now`); otherwise read once after mount. */
  now?: number;
  /**
   * Switching hives and starting one. Left out, they come from the nearest HiveActionsProvider;
   * with neither, the switcher only shows the person's hives.
   */
  hiveActions?: HiveActions;
}) {
  const provided = useHiveActions();
  const waiting = inbox ?? 0;
  const count = badge(waiting);
  const nav = useRef<HTMLElement>(null);
  const [barY, setBarY] = useState<number | null>(null);
  // Never read during render (server and client would differ): the page's clock, else one read
  // after mount.
  const [mounted, setMounted] = useState<number | null>(null);
  useEffect(() => setMounted(Date.now()), []);
  const now = nowProp ?? mounted;

  // One bar slides to the current row: its offset is measured, never guessed.
  useLayoutEffect(() => {
    const row = nav.current?.querySelector<HTMLElement>(
      '[aria-current="page"]',
    );
    setBarY(row ? row.offsetTop + (row.offsetHeight - 20) / 2 : null);
  }, [current]);

  return (
    <aside
      aria-label="Navigation"
      data-scope="chrome"
      className={`${s.rail} rise`}
    >
      <div className={s.brand}>
        <span aria-hidden="true" className={s.mark} />
        <HiveSwitcher actions={hiveActions ?? provided} />
      </div>
      <nav ref={nav} aria-label="Main" className={s.links}>
        {barY !== null && (
          <span
            aria-hidden="true"
            className={s.bar}
            style={{ transform: `translateY(${barY}px)` }}
          />
        )}
        {DESTINATIONS.map((d) => (
          <Link
            key={d.key}
            href={d.href}
            aria-current={d.key === current ? "page" : undefined}
            aria-label={
              d.key === "inbox" && count !== null
                ? `Inbox, ${waiting} waiting`
                : undefined
            }
            className={`${s.row} ${s.link} ${s.control}`}
          >
            <span className={s.slot}>{d.icon}</span>
            <span className={s.rowLabel}>{d.name}</span>
            {d.key === "inbox" && count !== null && (
              <span aria-hidden="true" className={s.count}>
                {count}
              </span>
            )}
          </Link>
        ))}
      </nav>
      <section className={s.foot}>
        {agents.length > 0 && now !== null && (
          <AgentsCard agents={agents} now={now} />
        )}
        <AccountMenu />
      </section>
    </aside>
  );
}
