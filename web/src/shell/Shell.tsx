// The left rail, shared by the map, the vault, the gallery, the inbox and the settings: the mark,
// the destinations (Map, Vault, Gallery, Inbox with the number waiting, Settings), the agents when
// given, the Appearance panel and sign out. It sits straight on the wash, so it is the "chrome"
// scope (white text in light mode).
import Link from "next/link";
import { badge } from "../inbox/text";
import { Appearance } from "./Appearance";
import s from "./shell.module.css";

export type AgentRow = {
  id: string;
  /** The agent's own name for the caller's agents; "<member>, <provider>" for colleagues'. */
  name: string;
  status: string;
  connected: boolean;
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
}: {
  current: "map" | "vault" | "gallery" | "inbox" | "settings";
  agents?: AgentRow[];
  /** How many links and held notes wait for the person; shown on the Inbox row. */
  inbox?: number;
}) {
  const waiting = inbox ?? 0;
  const count = badge(waiting);
  return (
    <aside aria-label="Navigation" data-scope="chrome" className={s.rail}>
      <div className={s.brand}>
        <span aria-hidden="true" className={s.mark} />
        <span className={s.brandName}>Hive</span>
      </div>
      <nav aria-label="Main" className={s.links}>
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
            className={`${s.row} ${s.control}`}
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
        {agents.length > 0 && (
          <>
            <h2 className={s.heading}>Agents</h2>
            <ul className={s.agentList}>
              {agents.map((a) => (
                <li key={a.id} className={s.agent}>
                  <span aria-hidden="true" className={s.slot}>
                    <span
                      className={s.agentDot}
                      data-on={a.connected || undefined}
                    />
                  </span>
                  <span className={s.agentName} title={a.name}>
                    {a.name}
                  </span>
                  <span className={s.agentStatus}>{a.status}</span>
                </li>
              ))}
            </ul>
          </>
        )}
        <Appearance />
        <form method="post" action="/auth/signout" className={s.signOutForm}>
          <button type="submit" className={`${s.row} ${s.control}`}>
            <span aria-hidden="true" className={s.slot}>
              <svg {...ICON}>
                <path d="M6.5 2.5h-3v11h3M10 5l3 3-3 3M13 8H6.5" />
              </svg>
            </span>
            <span className={s.rowLabel}>Sign out</span>
          </button>
        </form>
      </section>
    </aside>
  );
}
