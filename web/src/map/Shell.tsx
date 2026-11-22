// The left rail: the mark, the destinations (Map, Vault), the agents when given, and sign out.
import Link from "next/link";
import s from "./map.module.css";

export type AgentRow = {
  id: string;
  /** The agent's own name for the caller's agents; "<member>, <provider>" for colleagues'. */
  name: string;
  status: string;
  connected: boolean;
};

const DESTINATIONS = [
  { key: "map", href: "/", name: "Map" },
  { key: "vault", href: "/vault", name: "Vault" },
] as const;

export function Shell({
  current,
  agents = [],
}: {
  current: "map" | "vault";
  agents?: AgentRow[];
}) {
  return (
    <aside aria-label="Navigation" className={s.nav}>
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
            className={d.key === current ? s.current : s.destination}
          >
            {d.name}
          </Link>
        ))}
      </nav>
      <section className={s.agents}>
        {agents.length > 0 && (
          <>
            <h2 className={s.railHeading}>Agents</h2>
            <ul className={s.agentList}>
              {agents.map((a) => (
                <li key={a.id} className={s.agent}>
                  <span
                    aria-hidden="true"
                    className={s.agentDot}
                    data-on={a.connected || undefined}
                  />
                  <span className={s.agentName} title={a.name}>
                    {a.name}
                  </span>
                  <span className={s.agentStatus}>{a.status}</span>
                </li>
              ))}
            </ul>
          </>
        )}
        <form method="post" action="/auth/signout" className={s.signOutForm}>
          <button type="submit" className={s.signOut}>
            Sign out
          </button>
        </form>
      </section>
    </aside>
  );
}
