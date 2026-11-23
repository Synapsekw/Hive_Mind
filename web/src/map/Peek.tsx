"use client";
// The peek card: a small glass card next to the pointer (or the focused dot) with the hot dot's
// kind, title and a few facts. A locked item shows only that it is private, its topic and "Not
// shared with you", the same rule as the side panel. aria-hidden: the dot's own label and the
// side panel carry the same facts for a screen reader. Spec 1.3.
import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { colour } from "./nodeShape";
import type { MapModel, ModelNode } from "./types";
import s from "./map.module.css";

const WIDTH = 250;
const DX = 18;
const DY = 14;
const EDGE = 8;
const HOUR = 3_600_000;

const KIND: Record<ModelNode["kind"], string> = {
  note: "Note",
  file: "File",
  hub: "Topic",
  agent: "Agent",
  root: "Index",
};

/** When an item changed, as a sentence (`just now`, `2 h ago`); agents use agentShort. */
export function changed(t: number, now: number): string {
  const h = Math.floor((now - t) / HOUR);
  if (h < 1) return "just now";
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? "1 day ago" : `${d} days ago`;
}

/** Links to other items (the hub and index edges are structure, not links). */
function links(model: MapModel, n: ModelNode): number {
  if (n.kind === "hub" || n.kind === "root") return n.nb.length;
  return n.nb.filter((j) => {
    const k = model.nodes[j]?.kind;
    return k === "note" || k === "file";
  }).length;
}

export function Peek({
  node: n,
  model,
  owner,
  now,
  anchor,
}: {
  node: ModelNode;
  model: MapModel;
  /** The owning member's name. */
  owner: string | null;
  now: number;
  /** Client px of the pointer or the focused dot. */
  anchor: { x: number; y: number };
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [h, setH] = useState(120);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) setH(el.offsetHeight);
  }, [n]);

  // Below right of the anchor, flipped left or up to stay inside the window.
  const vw = typeof window !== "undefined" ? window.innerWidth : 1e4;
  const vh = typeof window !== "undefined" ? window.innerHeight : 1e4;
  let left = anchor.x + DX;
  if (left + WIDTH > vw - EDGE) left = anchor.x - DX - WIDTH;
  let top = anchor.y + DY;
  if (top + h > vh - EDGE) top = anchor.y - DY - h;
  left = Math.max(EDGE, left);
  top = Math.max(EDGE, top);

  const topic = model.topics[n.topic]?.name ?? "";
  const eyebrow = n.locked
    ? n.kind === "file"
      ? "Private file"
      : "Private note"
    : KIND[n.kind];
  const facts: [string, string][] = n.locked
    ? [
        ["Topic", topic],
        ["Access", "Not shared with you"],
      ]
    : n.kind === "hub"
      ? [
          ["Holds", `${model.topics[n.topic]?.count ?? 0} items`],
          ["Links", String(links(model, n))],
        ]
      : n.kind === "note" || n.kind === "file"
        ? [
            ["Topic", topic],
            ["By", owner ?? "Someone"],
            ["Changed", changed(n.updatedAt, now)],
            ["Links", String(links(model, n))],
          ]
        : n.kind === "agent"
          ? [
              ["By", owner ?? "Someone"],
              ["Links", String(links(model, n))],
            ]
          : [["Topics", String(model.topics.length)]];

  // In <body>: the map's glass panel (backdrop-filter) would otherwise anchor `fixed` to itself.
  return createPortal(
    <div
      ref={ref}
      aria-hidden="true"
      data-map-peek=""
      className={s.peek}
      style={{ left, top, "--c": colour(model, n) } as CSSProperties}
    >
      <p className={s.peekKind}>
        <span className={s.peekSwatch} data-kind={n.kind} />
        {eyebrow}
      </p>
      {!n.locked && <h4 className={s.peekTitle}>{n.title}</h4>}
      <dl className={s.peekFacts}>
        {facts.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </div>,
    document.body,
  );
}
