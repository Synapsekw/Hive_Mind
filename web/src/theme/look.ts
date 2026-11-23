import data from "./themes.json";

export type Mode = "dark" | "light";
export type Reach = "subtle" | "tinted" | "vivid";
export type DotMode = "theme" | "classic";
export type Look = { theme: string; mode: Mode; reach: Reach; dots: DotMode };

export const THEMES: readonly { id: string; label: string }[] = data.themes.map(
  (t) => ({
    id: t.id,
    label: t.label,
  }),
);
export const MODES: readonly Mode[] = ["dark", "light"];
export const REACHES: readonly Reach[] = ["subtle", "tinted", "vivid"];
export const DOT_MODES: readonly DotMode[] = ["theme", "classic"];
export const DEFAULT_LOOK: Look = {
  theme: data.default as string,
  mode: "dark",
  reach: "tinted",
  dots: "theme",
};
export const LOOK_COOKIE = "hive-look";

const THEME_IDS: readonly string[] = THEMES.map((t) => t.id);

function pick<T extends string>(
  allowed: readonly T[],
  value: string | undefined,
  fallback: T,
): T {
  return value !== undefined && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

/** Reads `<theme>.<mode>.<reach>.<dots>`; each part outside the allowed values falls back. */
export function parseLook(value: string | undefined): Look {
  // A real value is at most a few dozen characters; anything long is junk.
  const parts =
    typeof value === "string" && value.length <= 100 ? value.split(".") : [];
  return {
    theme: pick(THEME_IDS, parts[0], DEFAULT_LOOK.theme),
    mode: pick(MODES, parts[1], DEFAULT_LOOK.mode),
    reach: pick(REACHES, parts[2], DEFAULT_LOOK.reach),
    dots: pick(DOT_MODES, parts[3], DEFAULT_LOOK.dots),
  };
}

export function formatLook(look: Look): string {
  return `${look.theme}.${look.mode}.${look.reach}.${look.dots}`;
}
