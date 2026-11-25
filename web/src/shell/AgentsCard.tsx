"use client";

// The agents at the foot of the rail, folded into one glass card: a stack of status dots,
// "Agents" and "N of M live" beneath; it opens to one line per agent with when it last
// connected. On a folded rail only the dots show, and pressing them unfolds the rail first.
import { useEffect, useId, useState } from "react";
import { agentShort } from "./agentShort";
import { foldWide, useFold } from "./FoldProvider";
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
  const { fold, openRail } = useFold();
  const folded = fold.rail === "shut";
  // Folding the rail closes the list: there is no room for it in the strip.
  useEffect(() => {
    if (folded) setOpen(false);
  }, [folded]);
  const connected = agents.filter((a) => a.connected).length;
  return (
    <div className={s.agents} data-open={open || undefined}>
      <button
        type="button"
        className={`${s.agentsHead} ${s.control}`}
        aria-expanded={open}
        aria-controls={`${id}-body`}
        aria-label={`Agents, ${connected} of ${agents.length} live`}
        title={
          folded ? `Agents, ${connected} of ${agents.length} live` : undefined
        }
        onClick={() => {
          // Narrow windows never fold, whatever the cookie says.
          if (folded && foldWide()) {
            openRail();
            setOpen(true);
          } else setOpen((v) => !v);
        }}
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
          <b className={s.agentsTitle}>Agents</b>
          <span className={s.agentsLive}>
            {connected} of {agents.length} live
          </span>
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
