import data from "./themes.json";

export type Scheme = "dark" | "light";
/** The look is the theme alone; each theme is dark or light by itself. */
export type Look = { theme: string };

export const THEMES: readonly { id: string; label: string; scheme: Scheme }[] =
  data.themes.map((t) => ({
    id: t.id,
    label: t.label,
    scheme: t.scheme as Scheme,
  }));
export const DEFAULT_LOOK: Look = { theme: data.default as string };
export const LOOK_COOKIE = "hive-look";

const THEME_IDS: readonly string[] = THEMES.map((t) => t.id);

/**
 * Reads the theme id. A value from before the eight themes (`<theme>.<mode>.<reach>.<dots>`)
 * is read by its first part; anything that is not a theme falls back to the default.
 */
export function parseLook(value: string | undefined): Look {
  // A real value is a few characters; anything long is junk.
  const first =
    typeof value === "string" && value.length <= 100
      ? value.split(".")[0]
      : undefined;
  return {
    theme:
      first !== undefined && THEME_IDS.includes(first)
        ? first
        : DEFAULT_LOOK.theme,
  };
}

export function formatLook(look: Look): string {
  return look.theme;
}

export function schemeOf(theme: string): Scheme {
  return THEMES.find((t) => t.id === theme)?.scheme ?? "dark";
}
