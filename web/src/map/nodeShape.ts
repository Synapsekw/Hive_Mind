// What a node looks like, shared by the canvas, the hidden dot list and the detail rail. Shape
// doubles colour: circle = note, diamond = file, ringed = topic hub, hollow = not shared with
// you, hexagon = the hive index.
import type { MapModel, ModelNode } from "./types";

/** The index, agents and kind marks: the secondary text colour of the current scope. */
export const SOFT = "var(--fg2)";

const KIND_WORD: Record<ModelNode["kind"], string> = {
  note: "note",
  file: "file",
  hub: "group",
  agent: "agent",
  root: "index",
};

/** The node's colour: its topic's hue, or the secondary text colour for the index and agents. */
export function colour(model: MapModel, n: ModelNode): string {
  const t = n.topic >= 0 ? model.topics[n.topic] : undefined;
  return t ? `var(--hue-${t.hue + 1})` : SOFT;
}

/** The mark's diameter in screen pixels. */
export function size(n: ModelNode): number {
  if (n.kind === "root") return 28;
  if (n.kind === "hub") return 16;
  if (n.kind === "agent") return 14;
  return Math.min(10, 5 + n.nb.length);
}

export function ariaLabel(model: MapModel, n: ModelNode): string {
  const topic =
    n.topic >= 0 && n.kind !== "hub" ? `, ${model.topics[n.topic]!.name}` : "";
  // "Private note" / "Private file" already says the kind.
  if (n.locked) return `${n.title}${topic}`;
  return `${n.title}, ${KIND_WORD[n.kind]}${topic}`;
}
