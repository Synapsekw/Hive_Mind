// The map's dots as real buttons, for the keyboard and screen readers. The list is visually
// hidden; the canvas draws what it means (a focused button makes its dot hot and ringed). Each
// item is memoised and takes plain values only (never the model or a node object), so a filter,
// a selection or a new arrangement touches only the attributes that moved, and React never has
// to compare a 5,000-node model once per item.
import { memo } from "react";
import { ariaLabel } from "./nodeShape";
import type { MapModel, NodeKind } from "./types";
import s from "./map.module.css";

const f1 = (v: number) => v.toFixed(1);

const Item = memo(function Item({
  i,
  label,
  kind,
  topic,
  locked,
  on,
  sel,
  x,
  y,
  onFocusDot,
  onPick,
}: {
  i: number;
  label: string;
  kind: NodeKind;
  topic: number;
  locked: boolean;
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
        aria-label={label}
        aria-pressed={sel}
        data-map-dot=""
        data-kind={kind}
        data-topic={topic}
        data-locked={locked ? "" : undefined}
        data-lit={on ? "" : undefined}
        data-x={x}
        data-y={y}
        onFocus={() => onFocusDot(i)}
        onBlur={() => onFocusDot(null)}
        onClick={() => onPick(i)}
      />
    </li>
  );
});

export const DotList = memo(function DotList({
  model,
  pos,
  view,
  lit,
  sel,
  onFocusDot,
  onPick,
}: {
  model: MapModel;
  pos: [number, number][];
  /** The view `pos` belongs to (it lags the canvas until a glide lands). */
  view?: string;
  lit: boolean[];
  sel: number | null;
  onFocusDot(i: number | null): void;
  onPick(i: number): void;
}) {
  return (
    <ul aria-label="Items on the map" className={s.srList} data-view={view}>
      {model.nodes.map((n) => {
        const [x, y] = pos[n.i] ?? [500, 380];
        return (
          <Item
            key={n.i}
            i={n.i}
            label={ariaLabel(model, n)}
            kind={n.kind}
            topic={n.topic}
            locked={n.locked}
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
