"use client";
// The Hive's agent marks over time. A copy of the comb's marks: while `enabled` (the Hive view,
// the tab showing, no dot hot, motion allowed), about every 3.4 s each live mark moves to another
// recent cell of its member (`nextCell`), and 0.8 s later, once the canvas has glided it there,
// that cell's honey flares. Spec 1.0, "Agent marks show who is at the hive".
import { useEffect, useRef, useState } from "react";
import { nextCell, type AgentMark, type Comb } from "./hive";
import type { MapModel } from "./types";
import { reducedMotion } from "./useCamera";

const EVERY_MS = 3400;
const MOVE_MS = 800;

function useVisible(): boolean {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const on = () => setVisible(!document.hidden);
    on();
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  return visible;
}

function useReducedMotion(): boolean {
  const [still, setStill] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const on = () => setStill(reducedMotion());
    on();
    mq?.addEventListener?.("change", on);
    return () => mq?.removeEventListener?.("change", on);
  }, []);
  return still;
}

export function useMarks(
  comb: Comb,
  model: MapModel,
  now: number,
  enabled: boolean,
): { marks: AgentMark[]; flare: { node: number; at: number } | null } {
  const [state, setState] = useState({ comb, marks: comb.marks });
  const [flare, setFlare] = useState<{ node: number; at: number } | null>(null);
  // A new comb (a refresh, the minute) starts again from its own marks.
  let marks = state.marks;
  if (state.comb !== comb) {
    marks = comb.marks;
    setState({ comb, marks });
  }
  const visible = useVisible();
  const still = useReducedMotion();
  const on = enabled && visible && !still;

  const current = useRef(marks);
  current.current = marks;
  useEffect(() => {
    if (!on) return;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const tick = setInterval(() => {
      const size = comb.size;
      let j = 0;
      const next = current.current.map((m) => {
        const cell = nextCell(comb, model, m, now, Math.random());
        if (cell === null) return m;
        const [x, y] = comb.pos[cell]!;
        // Each arrival flares on its own beat, so two marks never share one update.
        const t = setTimeout(
          () => {
            timers.delete(t);
            setFlare({ node: cell, at: performance.now() });
          },
          MOVE_MS + j++ * 60,
        );
        timers.add(t);
        return {
          ...m,
          at: cell,
          pos: [x + size * 0.45, y - size * 0.52] as [number, number],
        };
      });
      if (j > 0) setState({ comb, marks: next });
    }, EVERY_MS);
    return () => {
      clearInterval(tick);
      for (const t of timers) clearTimeout(t);
    };
  }, [on, comb, model, now]);

  return { marks, flare };
}
