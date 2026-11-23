// A node's mark as a small DOM element, for the detail rail (at 9 px) and the Orbit view. The map
// itself draws its marks on the canvas (renderer.ts).
import type { CSSProperties } from "react";
import { colour, size } from "./nodeShape";
import type { MapModel, ModelNode } from "./types";
import s from "./map.module.css";

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
