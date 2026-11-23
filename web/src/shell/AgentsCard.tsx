"use client";

// The agents at the foot of the rail, folded into one glass card: a stack of status dots and
// "N of M agents connected"; it opens to one line per agent with when it last connected.
import { useId, useState } from "react";
import { agentShort } from "./agentShort";
import s from "./shell.module.css";
import type { AgentRow } from "./Shell";

export function AgentsCard({
  agents,
  now,
}: {
  agents: AgentRow[];
  now: number;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const connected = agents.filter((a) => a.connected).length;
  return (
    <div className={s.agents} data-open={open || undefined}>
      <button
        type="button"
        className={`${s.agentsHead} ${s.control}`}
        aria-expanded={open}
        aria-controls={`${id}-body`}
        aria-label={`Agents, ${connected} of ${agents.length} connected`}
        onClick={() => setOpen((v) => !v)}
      >
        <span aria-hidden="true" className={s.dotStack}>
          {agents.map((a) => (
            <span
              key={a.id}
              className={s.agentDot}
              data-on={a.connected || undefined}
            />
          ))}
        </span>
        <span aria-hidden="true" className={s.agentsText}>
          <b>
            {connected} of {agents.length}
          </b>{" "}
          agents connected
        </span>
        <svg
          aria-hidden="true"
          className={s.chevron}
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m3 4.5 3 3 3-3" />
        </svg>
      </button>
      <div id={`${id}-body`} className={s.agentsBody} inert={!open}>
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
              <span className={s.agentWhen}>
                {agentShort(a.lastUsedAt ?? null, now)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
