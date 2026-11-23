"use client";

// The Appearance panel, shown inside the account menu: mode, theme, dot colours and reach. Every
// choice applies at once through useLook (no request, no navigation).
import { useId, useRef, type KeyboardEvent } from "react";
import { THEMES, type DotMode, type Mode, type Reach } from "../theme/look";
import { useLook } from "./LookProvider";
import s from "./shell.module.css";
import { swatch } from "./swatch";

type Option<T extends string> = { value: T; label: string };

const MODE_OPTIONS: Option<Mode>[] = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
];
const DOT_OPTIONS: Option<DotMode>[] = [
  { value: "theme", label: "Follow theme" },
  { value: "classic", label: "Classic" },
];
const REACH_OPTIONS: Option<Reach>[] = [
  { value: "subtle", label: "Subtle" },
  { value: "tinted", label: "Tinted" },
  { value: "vivid", label: "Vivid" },
];
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
  label,
  labelledBy,
  swatches,
}: {
  options: Option<T>[];
  value: T;
  onChange(v: T): void;
  label?: string;
  labelledBy?: string;
  swatches?: Mode;
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
      aria-label={label}
      aria-labelledby={labelledBy}
      className={swatches ? s.swatches : s.segments}
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
            className={swatches ? s.swatch : s.segment}
            data-keep-colours={swatches ? "" : undefined}
            aria-label={swatches ? o.label : undefined}
            title={swatches ? o.label : undefined}
            // The one inline colour in the app: a theme's own seeds, read from themes.json.
            style={
              swatches ? { background: swatch(o.value, swatches) } : undefined
            }
            onClick={() => onChange(o.value)}
          >
            {swatches ? null : o.label}
          </button>
        );
      })}
    </div>
  );
}

/** The panel's body: mode, theme, dot colours and reach. Rendered inside the account menu. */
export function AppearancePanel({ id }: { id?: string }) {
  const { look, setLook } = useLook();
  const own = useId();
  const panelId = id ?? own;
  return (
    <div id={`${panelId}-panel`} data-scope="reset" className={s.popover}>
      <Radios
        label="Mode"
        options={MODE_OPTIONS}
        value={look.mode}
        onChange={(mode) => setLook({ mode })}
      />
      <Radios
        label="Theme"
        options={THEME_OPTIONS}
        value={look.theme}
        onChange={(theme) => setLook({ theme })}
        swatches={look.mode}
      />
      <div className={s.field}>
        <span id={`${panelId}-dots`} className={s.fieldLabel}>
          Dot colours
        </span>
        <Radios
          labelledBy={`${panelId}-dots`}
          options={DOT_OPTIONS}
          value={look.dots}
          onChange={(dots) => setLook({ dots })}
        />
      </div>
      <div className={s.field}>
        <span id={`${panelId}-reach`} className={s.fieldLabel}>
          How far the colour reaches
        </span>
        <Radios
          labelledBy={`${panelId}-reach`}
          options={REACH_OPTIONS}
          value={look.reach}
          onChange={(reach) => setLook({ reach })}
        />
      </div>
    </div>
  );
}

/** The current theme's name and swatch, for the Appearance row of the account menu. */
export function useCurrentTheme() {
  const { look } = useLook();
  const theme = THEMES.find((t) => t.id === look.theme) ?? THEMES[0]!;
  return { label: theme.label, colour: swatch(look.theme, look.mode) };
}
