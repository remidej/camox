/**
 * The theme part of the `camox` runtime (see `artifactRuntime.ts`), as a script fragment that
 * declares `camoxTheme`. It applies the page's tokens to the artifact's `:root`, exposes them raw
 * and as sRGB colors, and notifies `onTheme` subscribers. The body stays hidden until the first
 * theme arrives, so the artifact never paints in the wrong colors, or until a short fallback
 * timeout, so a page that never sends one can't hide it forever.
 *
 * Colors are computed inside the frame so canvas and WebGL code never parses CSS: hex, `rgb()`,
 * `hsl()`, `oklab()` and `oklch()` are converted directly, and any other color the browser
 * understands (named colors, `lab()`, `color-mix()`…) goes through a 1×1 canvas.
 *
 * Plain JavaScript in a template string: no backslashes, so nothing needs escaping.
 */
export const ARTIFACT_RUNTIME_THEME = `const camoxTheme = (() => {
  const listeners = new Set();
  let applied = [];
  let current = Object.freeze({ tokens: Object.freeze({}), colors: Object.freeze({}) });

  const hidden = document.createElement("style");
  hidden.textContent = "body { visibility: hidden !important; }";
  document.head.append(hidden);
  const reveal = () => hidden.remove();
  setTimeout(reveal, 300);

  const unit = (part, percentOf) => {
    if (part === "none") return 0;
    const value = parseFloat(part);
    return part.endsWith("%") ? (value / 100) * percentOf : value;
  };
  const hue = (part) => {
    if (part === "none") return 0;
    const value = parseFloat(part);
    if (part.endsWith("grad")) return value * 0.9;
    if (part.endsWith("rad")) return (value * 180) / Math.PI;
    if (part.endsWith("turn")) return value * 360;
    return value;
  };
  const encode = (linear) => {
    const x = Math.min(1, Math.max(0, linear));
    return x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
  };
  const fromOklab = (L, a, b) => {
    const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3);
    const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3);
    const s = Math.pow(L - 0.0894841775 * a - 1.291485548 * b, 3);
    return [
      encode(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
      encode(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
      encode(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    ];
  };
  const fromHsl = (h, s, l) => {
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
    return [f(0), f(8), f(4)];
  };
  const parse = (value) => {
    const text = value.trim().toLowerCase();
    if (text.startsWith("#")) {
      let hex = text.slice(1);
      if (!/^[0-9a-f]+$/.test(hex) || ![3, 4, 6, 8].includes(hex.length)) return null;
      if (hex.length < 6) hex = [...hex].map((digit) => digit + digit).join("");
      return [0, 2, 4].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255);
    }
    const open = text.indexOf("(");
    if (open < 0 || !text.endsWith(")")) return null;
    const parts = text.slice(open + 1, -1).split(/[^0-9a-z.%+-]+/).filter(Boolean);
    if (parts.length < 3) return null;
    if (parts.slice(0, 3).some((part) => part !== "none" && !Number.isFinite(parseFloat(part)))) {
      return null;
    }
    const [x, y, z] = parts;
    switch (text.slice(0, open)) {
      case "rgb":
      case "rgba":
        return [x, y, z].map((part) => unit(part, 255) / 255);
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
  };
  let canvas;
  const paint = (value) => {
    if (typeof CSS === "undefined" || !CSS.supports("color", value)) return null;
    canvas ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    if (!canvas) return null;
    canvas.clearRect(0, 0, 1, 1);
    canvas.fillStyle = value;
    canvas.fillRect(0, 0, 1, 1);
    const [r, g, b] = canvas.getImageData(0, 0, 1, 1).data;
    return [r / 255, g / 255, b / 255];
  };
  const toColor = (value) => {
    const rgb = parse(value) ?? paint(value);
    if (!rgb) return null;
    const [r, g, b] = rgb.map((channel) => Math.round(Math.min(1, Math.max(0, channel)) * 255));
    return Object.freeze({ r, g, b });
  };

  return {
    get current() {
      return current;
    },
    receive(message) {
      const tokens = {};
      const colors = {};
      for (const [name, value] of Object.entries(message.tokens || {})) {
        if (!name.startsWith("--") || typeof value !== "string") continue;
        tokens[name] = value;
        const color = toColor(value);
        if (color) colors[name] = color;
      }
      const root = document.documentElement.style;
      for (const name of applied) if (!Object.hasOwn(tokens, name)) root.removeProperty(name);
      for (const [name, value] of Object.entries(tokens)) root.setProperty(name, value);
      applied = Object.keys(tokens);
      reveal();
      current = Object.freeze({ tokens: Object.freeze(tokens), colors: Object.freeze(colors) });
      for (const listener of [...listeners]) listener(current);
    },
    subscribe(callback) {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    },
  };
})();`;
