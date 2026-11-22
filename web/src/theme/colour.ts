// Pure colour maths for the theme engine. Channels are 0..1, gamma-encoded sRGB.

export type RGB = { r: number; g: number; b: number };
export type RGBA = RGB & { a: number };

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export function fromHex(hex: string): RGB {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`not a hex colour: ${hex}`);
  let h = m[1]!;
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return {
    r: ((n >> 16) & 255) / 255,
    g: ((n >> 8) & 255) / 255,
    b: (n & 255) / 255,
  };
}

const byte = (x: number) => Math.round(clamp01(x) * 255);

export function toHex(c: RGB): string {
  return (
    "#" +
    [c.r, c.g, c.b].map((x) => byte(x).toString(16).padStart(2, "0")).join("")
  );
}

/** As CSS `color-mix(in srgb, a, b shareOfB)` for opaque colours: per-channel interpolation. */
export function mix(a: RGB, b: RGB, shareOfB: number): RGB {
  const t = shareOfB;
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  };
}

/** Source-over compositing of a translucent colour onto an opaque one. */
export function over(top: RGBA, under: RGB): RGB {
  return mix(under, top, top.a);
}

const toLinear = (c: number) =>
  c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
const toGamma = (c: number) =>
  c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;

/** WCAG 2 relative luminance. */
export function luminance(c: RGB): number {
  return (
    0.2126 * toLinear(c.r) + 0.7152 * toLinear(c.g) + 0.0722 * toLinear(c.b)
  );
}

/** WCAG 2 contrast ratio, 1..21. */
export function contrast(a: RGB, b: RGB): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// OKLab, Björn Ottosson's matrices (the prototype's `hue()` uses the same ones).
export function toOklch(c: RGB): { l: number; c: number; h: number } {
  const r = toLinear(c.r);
  const g = toLinear(c.g);
  const b = toLinear(c.b);
  const l_ = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m_ = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const A = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const B = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
  return {
    l: L,
    c: Math.sqrt(A * A + B * B),
    h: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360,
  };
}

function oklchToLinear(
  l: number,
  c: number,
  h: number,
): [number, number, number] {
  const rad = (h * Math.PI) / 180;
  const A = c * Math.cos(rad);
  const B = c * Math.sin(rad);
  const l_ = l + 0.3963377774 * A + 0.2158037573 * B;
  const m_ = l - 0.1055613458 * A - 0.0638541728 * B;
  const s_ = l - 0.0894841775 * A - 1.291485548 * B;
  const L = l_ ** 3;
  const M = m_ ** 3;
  const S = s_ ** 3;
  return [
    4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
    -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
    -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S,
  ];
}

const EPS = 1e-6;
const inGamut = (v: [number, number, number]) =>
  v.every((x) => x >= -EPS && x <= 1 + EPS);

/** OKLCH to sRGB; lightness is clamped to 0..1 and chroma reduced until the colour fits. */
export function fromOklch(l: number, c: number, h: number): RGB {
  const L = clamp01(l);
  let lin = oklchToLinear(L, c, h);
  if (!inGamut(lin)) {
    let lo = 0;
    let hi = c;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklchToLinear(L, mid, h))) lo = mid;
      else hi = mid;
    }
    lin = oklchToLinear(L, lo, h);
  }
  const [r, g, b] = lin.map((x) => clamp01(toGamma(clamp01(x))));
  return { r: r!, g: g!, b: b! };
}

const alpha3 = (a: number) => Math.round(a * 1000) / 1000;

/** "#rrggbb" for an opaque colour, otherwise "rgba(r, g, b, a)" with the alpha to 3 decimals. */
export function css(c: RGB | RGBA): string {
  if ("a" in c && alpha3(c.a) < 1) {
    const [r, g, b] = [c.r, c.g, c.b].map(byte);
    return `rgba(${r}, ${g}, ${b}, ${alpha3(c.a).toFixed(3)})`;
  }
  return toHex(c);
}

/** Reads back what `css()` writes. */
export function parseColour(value: string): RGBA {
  const v = value.trim();
  if (v.startsWith("#")) return { ...fromHex(v), a: 1 };
  const m =
    /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(
      v,
    );
  if (!m) throw new Error(`not a colour: ${value}`);
  return {
    r: Number(m[1]) / 255,
    g: Number(m[2]) / 255,
    b: Number(m[3]) / 255,
    a: m[4] === undefined ? 1 : Number(m[4]),
  };
}

/** The colour exactly as the stylesheet will carry it: 8-bit channels, alpha to 3 decimals. */
export function quantize<T extends RGB | RGBA>(c: T): T {
  const q = fromHex(toHex(c));
  return ("a" in c ? { ...q, a: alpha3(c.a) } : q) as T;
}
