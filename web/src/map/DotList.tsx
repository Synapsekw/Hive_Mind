// The map's dots as real buttons, for the keyboard and screen readers. The list is visually
// hidden; the canvas draws what it means (a focused button makes its dot hot and ringed). Each
// item is memoised, so a filter or selection change touches only the attributes that moved.
import { memo } from "react";
import { ariaLabel } from "./nodeShape";
import type { MapModel, ModelNode } from "./types";
import s from "./map.module.css";

const f1 = (v: number) => v.toFixed(1);

const Item = memo(function Item({
  model,
  n,
  on,
  sel,
  x,
  y,
  onFocusDot,
  onPick,
}: {
  model: MapModel;
  n: ModelNode;
  on: boolean;
  sel: boolean;
  x: string;
  y: string;
  onFocusDot: (i: number | null) => void;
  onPick: (i: number) => void;
}) {
  return (
    <li>
      <button
        type="button"
        aria-label={ariaLabel(model, n)}
        aria-pressed={sel}
        data-map-dot=""
        data-kind={n.kind}
        data-topic={n.topic}
        data-locked={n.locked ? "" : undefined}
        data-lit={on ? "" : undefined}
        data-x={x}
        data-y={y}
        onFocus={() => onFocusDot(n.i)}
        onBlur={() => onFocusDot(null)}
        onClick={() => onPick(n.i)}
      />
    </li>
  );
});

export const DotList = memo(function DotList({
  model,
  pos,
  lit,
  sel,
  onFocusDot,
  onPick,
}: {
  model: MapModel;
  pos: [number, number][];
  lit: boolean[];
  sel: number | null;
  onFocusDot(i: number | null): void;
  onPick(i: number): void;
}) {
  return (
    <ul aria-label="Items on the map" className={s.srList}>
      {model.nodes.map((n) => {
        const [x, y] = pos[n.i] ?? [500, 380];
        return (
          <Item
            key={n.i}
            model={model}
            n={n}
            on={!!lit[n.i]}
            sel={sel === n.i}
            x={f1(x)}
            y={f1(y)}
            onFocusDot={onFocusDot}
            onPick={onPick}
          />
        );
      })}
    </ul>
  );
});
