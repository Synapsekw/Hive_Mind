// The orbit view: the same dots on a slowly turning CSS 3D sphere, agents on an outer ring.
// Each dot is a billboard that counter-rotates so it always faces the viewer. The flat views are
// drawn on the canvas (MapCanvas); Orbit keeps its DOM dots until it moves onto the canvas too.
import { memo, type CSSProperties } from "react";
import { ariaLabel, size } from "./nodeShape";
import { Shape } from "./Shape";
import type { MapModel, ModelNode } from "./types";
import s from "./map.module.css";

const f = (v: number) => String(Math.round(v * 10) / 100);
const BILLBOARD = `${s.dot} ${s.billboard}`;

export type DotState = {
  on: boolean;
  sel: boolean;
  label: boolean;
};

/** One orbit dot. Props stay the same for a model, so an unchanged dot is not drawn again. */
const Dot = memo(function Dot({
  model,
  n,
  on,
  sel,
  label,
  onPick,
}: {
  model: MapModel;
  n: ModelNode;
  on: boolean;
  sel: boolean;
  label: boolean;
  onPick: (i: number) => void;
}) {
  return (
    <button
      type="button"
      className={BILLBOARD}
      aria-label={ariaLabel(model, n)}
      aria-pressed={sel}
      onClick={() => onPick(n.i)}
      data-map-dot=""
      data-kind={n.kind}
      data-topic={n.topic}
      data-locked={n.locked || undefined}
      data-lit={on || undefined}
    >
      <Shape model={model} n={n} sel={sel} />
      {label && (
        <span
          aria-hidden="true"
          className={s.label}
          style={{ "--d": `${size(n)}px` } as CSSProperties}
          data-strong={sel || n.kind === "hub" || undefined}
        >
          {n.title}
        </span>
      )}
    </button>
  );
});

export function Orbit({
  model,
  pos,
  states,
  onPick,
}: {
  model: MapModel;
  pos: [number, number, number][];
  states: DotState[];
  onPick: (i: number) => void;
}) {
  return (
    <div className={s.orbit}>
      <div className={s.orbitTilt}>
        <div className={s.spin}>
          <div aria-hidden="true" className={s.equator} />
          {model.nodes.map((n) => {
            const [x, y, z] = pos[n.i] ?? [0, 0, 0];
            const st = states[n.i]!;
            return (
              <div
                key={n.i}
                className={s.at}
                style={{
                  transform: `translate3d(${f(x)}cqw, ${f(y)}cqw, ${f(z)}cqw)`,
                }}
              >
                <Dot
                  model={model}
                  n={n}
                  on={st.on}
                  sel={st.sel}
                  label={st.label}
                  onPick={onPick}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
