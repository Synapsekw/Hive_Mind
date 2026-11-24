"use client";
// A highlight that slides under the active control of a segmented group. The group stays the
// accessible thing (buttons with aria-pressed, or tabs); the pill is decoration (aria-hidden).
import {
  useLayoutEffect,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";

export function pillRect(
  container: DOMRect,
  active: DOMRect,
): { left: number; width: number } {
  return {
    left: active.left - container.left,
    width: Math.max(0, active.width),
  };
}

export function useSlidingPill(
  group: RefObject<HTMLElement | null>,
  activeSelector: string,
  key: unknown,
): CSSProperties {
  const [style, setStyle] = useState<CSSProperties>({ opacity: 0 });
  useLayoutEffect(() => {
    const el = group.current;
    if (!el) return;
    const measure = () => {
      const active = el.querySelector<HTMLElement>(activeSelector);
      if (!active) return setStyle({ opacity: 0 });
      const { left, width } = pillRect(
        el.getBoundingClientRect(),
        active.getBoundingClientRect(),
      );
      setStyle({ left, width, opacity: 1 });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [group, activeSelector, key]);
  return style;
}
