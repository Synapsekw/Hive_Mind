"use client";

// The Appearance panel, shown inside the account popover: the theme. The choice applies at once
// through useLook (no request, no navigation).
import { useId, useRef, type KeyboardEvent } from "react";
import { THEMES } from "../theme/look";
import { useLook } from "./LookProvider";
import s from "./shell.module.css";
import { swatch } from "./swatch";

type Option<T extends string> = { value: T; label: string };

const THEME_OPTIONS: Option<string>[] = THEMES.map((t) => ({
  value: t.id,
  label: t.label,
}));

const NEXT: Record<string, number> = { ArrowRight: 1, ArrowDown: 1 };
const PREV: Record<string, number> = { ArrowLeft: -1, ArrowUp: -1 };

/** A radio group with one tab stop: arrow keys move the choice and the focus, wrapping. */
function Radios<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Option<T>[];
  value: T;
  onChange(v: T): void;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const at = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const n = options.length;
    let to: number | null = null;
    if (e.key in NEXT) to = (at + 1) % n;
    else if (e.key in PREV) to = (at - 1 + n) % n;
    else if (e.key === "Home") to = 0;
    else if (e.key === "End") to = n - 1;
    if (to === null) return;
    e.preventDefault();
    onChange(options[to]!.value);
    refs.current[to]?.focus();
  };
  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className={s.swatches}
      onKeyDown={onKeyDown}
    >
      {options.map((o, i) => {
        const on = i === at;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            className={s.swatch}
            data-keep-colours=""
            aria-label={o.label}
            title={o.label}
            // The one inline colour in the app: a theme's own colours, read from themes.json.
            style={{ background: swatch(o.value) }}
            onClick={() => onChange(o.value)}
          ></button>
        );
      })}
    </div>
  );
}

/** The panel's body: the theme. Rendered inside the account popover. */
export function AppearancePanel({ id }: { id?: string }) {
  const { look, setLook } = useLook();
  const own = useId();
  const panelId = id ?? own;
  return (
    <div id={`${panelId}-panel`} className={s.popover}>
      <Radios
        options={THEME_OPTIONS}
        value={look.theme}
        onChange={(theme) => setLook({ theme })}
      />
    </div>
  );
}

/** The current theme's name and swatch, for the Appearance row of the account popover. */
export function useCurrentTheme() {
  const { look } = useLook();
  const theme = THEMES.find((t) => t.id === look.theme) ?? THEMES[0]!;
  return { label: theme.label, colour: swatch(look.theme) };
}
