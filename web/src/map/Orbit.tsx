// The orbit view: the same dots on a slowly turning CSS 3D sphere, agents on an outer ring.
// Each dot is a billboard that counter-rotates so it always faces the viewer.
import type { MapModel } from "./types";
import { Dot, type DotState } from "./Dots";
import s from "./map.module.css";

const f = (v: number) => String(Math.round(v * 10) / 100);
const BILLBOARD = `${s.dot} ${s.billboard}`;

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
                  className={BILLBOARD}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
