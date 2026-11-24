// The legend dock: a floating glass bar at the stage's bottom-left with topics, kinds and people.
// Pointing at an entry previews it on the map (the rest drops to the soft dim); a click pins it
// as the filter. Names are text nodes only.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { Preview } from "./MapCanvas";
import type { MapModel, NodeKind } from "./types";
import s from "./map.module.css";

const KINDS: [NodeKind, string][] = [
  ["note", "Notes"],
  ["file", "Files"],
  ["hub", "Groups"],
  ["agent", "Agents"],
];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const a = parts[0]?.[0] ?? "?";
  const b = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (a + b).toUpperCase();
}

/** Pointer and focus handlers that preview `p` while the entry is pointed at or focused. */
function aim(onPreview: (p: Preview | null) => void, p: Preview) {
  return {
    onPointerEnter: () => onPreview(p),
    onPointerLeave: () => onPreview(null),
    onFocus: () => onPreview(p),
    onBlur: () => onPreview(null),
  };
}

export function Dock({
  model,
  heading,
  topic,
  onTopic,
  kind,
  onKind,
  member,
  onMember,
  onPreview,
}: {
  model: MapModel;
  heading: string;
  topic: number | null;
  onTopic: (t: number | null) => void;
  kind: NodeKind | null;
  onKind: (k: NodeKind | null) => void;
  member: string | null;
  onMember: (m: string | null) => void;
  onPreview: (p: Preview | null) => void;
}) {
  const row = useRef<HTMLDivElement>(null);
  const [over, setOver] = useState(false);

  // The wheel scrolls the topics sideways; the fade shows only while it overflows.
  useEffect(() => {
    const el = row.current;
    if (!el) return;
    const measure = () => setOver(el.scrollWidth > el.clientWidth + 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth) return;
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      el.scrollLeft += d;
      e.preventDefault();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      ro.disconnect();
      el.removeEventListener("wheel", onWheel);
    };
  }, [model.topics.length]);

  if (model.nodes.length <= 1) return null;
  return (
    <div className={s.dock} data-map-overlay="">
      <div role="group" aria-label={heading} className={s.dockGroup}>
        <span aria-hidden="true" className={s.dockLabel}>
          {heading}
        </span>
        <div ref={row} className={s.dockTopics} data-over={over || undefined}>
          {model.topics.map((t, i) => (
            <button
              key={i}
              type="button"
              className={s.dockItem}
              aria-pressed={topic === i}
              data-quiet={(topic !== null && topic !== i) || undefined}
              style={{ "--c": `var(--hue-${t.hue + 1})` } as CSSProperties}
              onClick={() => onTopic(topic === i ? null : i)}
              {...aim(onPreview, { topic: i })}
            >
              <span aria-hidden="true" className={s.dockSwatch} />
              {t.name}
              <span aria-hidden="true" className={s.dockCount}>
                {t.count}
              </span>
            </button>
          ))}
        </div>
      </div>
      <span aria-hidden="true" className={s.dockRule} />
      <div role="group" aria-label="Kinds" className={s.dockGroup}>
        <span aria-hidden="true" className={s.dockLabel}>
          Kind
        </span>
        {KINDS.map(([k, name]) => (
          <button
            key={k}
            type="button"
            className={`${s.dockItem} ${s.dockIcon}`}
            aria-label={name}
            aria-pressed={kind === k}
            data-quiet={(kind !== null && kind !== k) || undefined}
            onClick={() => onKind(kind === k ? null : k)}
            {...aim(onPreview, { kind: k })}
          >
            <span aria-hidden="true" className={s.chipDot} data-kind={k} />
            <span aria-hidden="true" className={s.dockTip}>
              {name}
            </span>
          </button>
        ))}
        <span className={`${s.dockItem} ${s.dockIcon} ${s.dockLegend}`}>
          <span aria-hidden="true" className={s.legendDot} />
          <span aria-hidden="true" className={s.dockTip}>
            Not shared with you
          </span>
          <span className={s.srOnly}>Not shared with you</span>
        </span>
      </div>
      <span aria-hidden="true" className={s.dockRule} />
      <div role="group" aria-label="People" className={s.dockGroup}>
        <span aria-hidden="true" className={s.dockLabel}>
          People
        </span>
        {model.members.map((m) => {
          const name = m.isMe ? `${m.name} (you)` : m.name;
          return (
            <button
              key={m.id}
              type="button"
              className={`${s.dockItem} ${s.dockIcon}`}
              aria-label={name}
              aria-pressed={member === m.id}
              data-quiet={(member !== null && member !== m.id) || undefined}
              onClick={() => onMember(member === m.id ? null : m.id)}
              {...aim(onPreview, { member: m.id })}
            >
              <span aria-hidden="true" className={s.dockAvatar}>
                {initials(m.name)}
              </span>
              <span aria-hidden="true" className={s.dockTip}>
                {name}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
