"use client";
// "At the hive": a small glass panel at the top right of the Hive's stage, naming the live and
// today agents (their mark, the name, then "live" or "2h", as in the rail) and how many wait idle at the
// entrance. Real text, so a screen reader hears who is live. Hovering a row makes that agent's
// mark hot. Spec 1.0.
import type { CSSProperties } from "react";
import { agentShort } from "../shell/agentShort";
import type { AgentMark } from "./hive";
import s from "./map.module.css";

/** The agent's mark, as on the canvas: a hexagon outline with a centre by state. */
function Mark({ state }: { state: AgentMark["state"] }) {
  const pts = Array.from({ length: 6 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / 3;
    return `${(7 + 5.6 * Math.cos(a)).toFixed(2)},${(7 + 5.6 * Math.sin(a)).toFixed(2)}`;
  }).join(" ");
  return (
    <svg
      aria-hidden="true"
      className={s.presenceMark}
      data-state={state}
      width="14"
      height="14"
      viewBox="0 0 14 14"
    >
      <polygon points={pts} />
      <circle cx="7" cy="7" r={state === "live" ? 2.4 : 1.2} />
    </svg>
  );
}

export function Presence({
  marks,
  names,
  now,
  onHot,
}: {
  marks: AgentMark[];
  /** Agent node -> its name and when its token was last used. */
  names: Map<number, { name: string; lastUsedAt: string | null }>;
  now: number;
  onHot(node: number | null): void;
}) {
  const here = marks
    .filter((m) => m.state !== "idle")
    .sort((a, b) => +(b.state === "live") - +(a.state === "live"));
  const idle = marks.length - here.length;
  return (
    <aside
      aria-label="At the hive"
      data-map-overlay=""
      className={`${s.presence} rise`}
      style={{ "--rise-delay": "0.6s" } as CSSProperties}
    >
      <p className={s.presenceHead}>At the hive</p>
      {here.length > 0 && (
        <ul className={s.presenceList}>
          {here.map((m) => {
            const info = names.get(m.node);
            return (
              // Focusable, so the keyboard reaches what hover shows: focus makes the mark hot.
              <li
                key={m.node}
                tabIndex={0}
                onPointerEnter={() => onHot(m.node)}
                onPointerLeave={() => onHot(null)}
                onFocus={() => onHot(m.node)}
                onBlur={() => onHot(null)}
              >
                <Mark state={m.state} />
                <span className={s.presenceName}>{info?.name ?? "Agent"}</span>
                {m.state === "live" ? (
                  <span className={s.presenceLive}>live</span>
                ) : (
                  <span className={s.presenceAgo}>
                    {agentShort(info?.lastUsedAt ?? null, now)}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {idle > 0 && (
        <p className={s.presenceIdle}>{idle} idle at the entrance</p>
      )}
    </aside>
  );
}
