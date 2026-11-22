// The dots: one real button per node. Shape doubles colour: circle = note, diamond = file,
// ringed = topic hub, hollow = not shared with you, hexagon = the hive index.
import type { CSSProperties } from "react";
import type { MapModel, ModelNode } from "./types";
import s from "./map.module.css";

export const SOFT = "#b4bed0";

/** Two decimals, written the way the browser writes them back (no trailing zeros). */
const pct = (v: number) => String(Math.round(v * 100) / 100);

const KIND_WORD: Record<ModelNode["kind"], string> = {
  note: "note",
  file: "file",
  hub: "topic",
  agent: "agent",
  root: "index",
};

/** The node's colour: its topic's hue, or a soft grey for the index and agents. */
export function colour(model: MapModel, n: ModelNode): string {
  const t = n.topic >= 0 ? model.topics[n.topic] : undefined;
  return t ? `var(--hue-${t.hue + 1})` : SOFT;
}

export function size(n: ModelNode): number {
  if (n.kind === "root") return 28;
  if (n.kind === "hub") return 16;
  if (n.kind === "agent") return 14;
  return Math.min(10, 5 + n.nb.length);
}

export function ariaLabel(model: MapModel, n: ModelNode): string {
  const topic =
    n.topic >= 0 && n.kind !== "hub" ? `, ${model.topics[n.topic]!.name}` : "";
  return `${n.title}, ${KIND_WORD[n.kind]}${topic}`;
}

/** The mark itself, also used at 9 px in the detail rail. */
export function Shape({
  model,
  n,
  d,
  sel = false,
}: {
  model: MapModel;
  n: ModelNode;
  d?: number;
  sel?: boolean;
}) {
  const style = {
    "--c": colour(model, n),
    "--d": `${d ?? size(n)}px`,
  } as CSSProperties;
  return (
    <span
      aria-hidden="true"
      className={s.shape}
      style={style}
      data-kind={n.kind}
      data-locked={n.locked || undefined}
      data-theirs={
        (!n.mine && (n.kind === "note" || n.kind === "file")) || undefined
      }
      data-sel={sel || undefined}
    />
  );
}

export type DotState = {
  on: boolean;
  sel: boolean;
  label: boolean;
};

/** One dot. `className`/`style` place it; the flat and orbit views place it differently. */
export function Dot({
  model,
  n,
  st,
  onPick,
  className,
  style,
  flip = false,
}: {
  model: MapModel;
  n: ModelNode;
  st: DotState;
  onPick: (i: number) => void;
  className: string;
  style: CSSProperties;
  flip?: boolean;
}) {
  const d = size(n);
  return (
    <button
      type="button"
      className={className}
      style={{ ...style, opacity: st.on ? 1 : 0.1 }}
      aria-label={ariaLabel(model, n)}
      aria-pressed={st.sel}
      onClick={() => onPick(n.i)}
      data-map-dot=""
      data-kind={n.kind}
      data-topic={n.topic}
      data-locked={n.locked || undefined}
      data-lit={st.on || undefined}
    >
      <Shape model={model} n={n} sel={st.sel} />
      {st.label && (
        <span
          aria-hidden="true"
          className={s.label}
          style={{ "--d": `${d}px` } as CSSProperties}
          data-flip={flip || undefined}
          data-strong={st.sel || n.kind === "hub" || undefined}
        >
          {n.title}
        </span>
      )}
    </button>
  );
}

/** The five flat views: dots positioned by percentage inside the 1000 x 760 box. */
export function FlatDots({
  model,
  pos,
  states,
  onPick,
  hidden,
}: {
  model: MapModel;
  pos: [number, number][];
  states: DotState[];
  onPick: (i: number) => void;
  hidden: boolean;
}) {
  return (
    <div className={s.flat} hidden={hidden}>
      {model.nodes.map((n) => {
        const [x, y] = pos[n.i] ?? [500, 380];
        return (
          <Dot
            key={n.i}
            model={model}
            n={n}
            st={states[n.i]!}
            onPick={onPick}
            className={s.dot}
            style={{
              left: `${pct(x / 10)}%`,
              top: `${pct(y / 7.6)}%`,
            }}
            flip={x > 760}
          />
        );
      })}
    </div>
  );
}
