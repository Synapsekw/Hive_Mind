import { describe, expect, it } from "vitest";
import { contrast, over, parseColour, type RGB } from "./colour";
import { THEMES } from "./look";
import { tokens } from "./tokens";

// Every theme against the limits of the spec, section 6. A failure is fixed by hand in
// themes.json; nothing adjusts a colour automatically.
const opaque = (value: string): RGB => {
  const c = parseColour(value);
  expect(c.a, value).toBe(1);
  return c;
};

describe.each(THEMES.map((t) => t.id))("contrast in %s", (id) => {
  const t = tokens(id);
  const bg = opaque(t["--bg"]!);
  const card = opaque(t["--glass"]!);
  const ratio = (fg: string, on: RGB) => contrast(opaque(t[fg]!), on);

  it("text and muted text reach 4.5:1 on the page and the card", () => {
    for (const fg of ["--fg", "--muted"])
      for (const on of [bg, card])
        expect(ratio(fg, on), fg).toBeGreaterThanOrEqual(4.5);
    expect(ratio("--fg2", card)).toBeGreaterThanOrEqual(4.5);
  });

  it("muted text reaches 4.5:1 on the active fill", () => {
    expect(ratio("--muted", opaque(t["--active-bg"]!))).toBeGreaterThanOrEqual(
      4.5,
    );
  });

  it("quiet labels, the accent and the hub reach 3:1", () => {
    for (const on of [bg, card]) {
      expect(ratio("--quiet", on)).toBeGreaterThanOrEqual(3);
      expect(ratio("--acc", on)).toBeGreaterThanOrEqual(3);
    }
    expect(ratio("--hub", card)).toBeGreaterThanOrEqual(3);
  });

  it("the three freshest ramp steps reach 3:1 on the card", () => {
    for (const i of [5, 6, 7])
      expect(
        ratio(`--fresh-${i}`, card),
        `--fresh-${i}`,
      ).toBeGreaterThanOrEqual(3);
  });

  it("the ramp gets steadily easier to see", () => {
    const r = Array.from({ length: 8 }, (_, i) => ratio(`--fresh-${i}`, card));
    for (let i = 1; i < 8; i++) expect(r[i]!).toBeGreaterThan(r[i - 1]!);
  });

  it("the eight topic colours reach 3:1 on the card", () => {
    for (let i = 1; i <= 8; i++)
      expect(ratio(`--hue-${i}`, card), `--hue-${i}`).toBeGreaterThanOrEqual(3);
  });

  it("text on the accent reaches 4.5:1", () => {
    expect(ratio("--on-brand", opaque(t["--brand"]!))).toBeGreaterThanOrEqual(
      4.5,
    );
  });

  it("the active item's text reaches 4.5:1 on its fill", () => {
    expect(
      ratio("--active-fg", opaque(t["--active-bg"]!)),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("text on a hover fill still reaches 4.5:1", () => {
    const fill = over(parseColour(t["--fill"]!), card);
    expect(ratio("--fg", fill)).toBeGreaterThanOrEqual(4.5);
  });
});
