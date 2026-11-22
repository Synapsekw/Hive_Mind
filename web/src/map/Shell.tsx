// The left rail: the mark, the one destination that exists (Map), the agents and sign out.
import s from "./map.module.css";

export type AgentRow = {
  id: string;
  /** The agent's own name for the caller's agents; "<member>, <provider>" for colleagues'. */
  name: string;
  status: string;
  connected: boolean;
};

export function Shell({ agents }: { agents: AgentRow[] }) {
  return (
    <aside aria-label="Navigation" className={s.nav}>
      <div className={s.brand}>
        <span aria-hidden="true" className={s.mark} />
        <span className={s.brandName}>Hive</span>
      </div>
      <nav aria-label="Main" className={s.links}>
        <span aria-current="page" className={s.current}>
          Map
        </span>
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
