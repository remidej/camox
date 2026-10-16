import type { ArtifactThemeTokens } from "./artifactTheme";

/** A color token as sRGB channels from 0 to 255, for canvas and WebGL code. */
export type ArtifactColor = { r: number; g: number; b: number };

type Channels = [number, number, number];

const unit = (part: string, percentOf: number) => {
  if (part === "none") return 0;
  const value = parseFloat(part);
  return part.endsWith("%") ? (value / 100) * percentOf : value;
};

const hue = (part: string) => {
  if (part === "none") return 0;
  const value = parseFloat(part);
  if (part.endsWith("grad")) return value * 0.9;
  if (part.endsWith("rad")) return (value * 180) / Math.PI;
  if (part.endsWith("turn")) return value * 360;
  return value;
};

const encode = (linear: number) => {
  const x = Math.min(1, Math.max(0, linear));
  return x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
};

const fromOklab = (L: number, a: number, b: number): Channels => {
  const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3);
  const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3);
  const s = Math.pow(L - 0.0894841775 * a - 1.291485548 * b, 3);
  return [
    encode(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    encode(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    encode(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
};

const fromHsl = (h: number, s: number, l: number): Channels => {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0), f(8), f(4)];
};

/** Hex, `rgb()`, `hsl()`, `oklab()` and `oklch()` colors, as channels from 0 to 1. */
function parse(value: string): Channels | null {
  const text = value.trim().toLowerCase();
  if (text.startsWith("#")) {
    let hex = text.slice(1);
    if (!/^[0-9a-f]+$/.test(hex) || ![3, 4, 6, 8].includes(hex.length)) return null;
    if (hex.length < 6) hex = hex.replace(/./g, "$&$&");
    const [r, g, b] = [0, 2, 4].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255);
    return [r, g, b];
  }
  const open = text.indexOf("(");
  if (open < 0 || !text.endsWith(")")) return null;
  const parts = text
    .slice(open + 1, -1)
    .split(/[^0-9a-z.%+-]+/)
    .filter(Boolean);
  if (parts.length < 3) return null;
  if (parts.slice(0, 3).some((part) => part !== "none" && !Number.isFinite(parseFloat(part)))) {
    return null;
  }
  const [x, y, z] = parts;
  switch (text.slice(0, open)) {
    case "rgb":
    case "rgba":
      return [unit(x, 255) / 255, unit(y, 255) / 255, unit(z, 255) / 255];
    case "hsl":
    case "hsla":
      return fromHsl(hue(x), parseFloat(y) / 100 || 0, parseFloat(z) / 100 || 0);
    case "oklab":
      return fromOklab(unit(x, 1), unit(y, 0.4), unit(z, 0.4));
    case "oklch": {
      const chroma = unit(y, 0.4);
      const angle = (hue(z) * Math.PI) / 180;
      return fromOklab(unit(x, 1), chroma * Math.cos(angle), chroma * Math.sin(angle));
    }
    default:
      return null;
  }
}

/**
 * The sRGB colors of a page's theme tokens, so artifacts get them ready to use and never parse
 * CSS themselves. Common color syntaxes are converted directly; any other color the page's
 * browser understands (named colors, `lab()`, `color-mix()`…) goes through a 1×1 canvas of the
 * page's own document. Tokens that aren't colors are left out.
 */
export function artifactThemeColors(
  tokens: ArtifactThemeTokens,
  page: Window & typeof globalThis,
): Record<string, ArtifactColor> {
  let canvas: CanvasRenderingContext2D | null | undefined;
  const paint = (value: string): Channels | null => {
    if (!page.CSS?.supports("color", value)) return null;
    canvas ??= page.document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    if (!canvas) return null;
    canvas.clearRect(0, 0, 1, 1);
    canvas.fillStyle = value;
    canvas.fillRect(0, 0, 1, 1);
    const [r, g, b] = canvas.getImageData(0, 0, 1, 1).data;
    return [r / 255, g / 255, b / 255];
  };

  const colors: Record<string, ArtifactColor> = {};
  for (const [name, value] of Object.entries(tokens)) {
    const channels = parse(value) ?? paint(value);
    if (!channels) continue;
    const [r, g, b] = channels.map((channel) =>
      Math.round(Math.min(1, Math.max(0, channel)) * 255),
    );
    colors[name] = { r, g, b };
  }
  return colors;
}
