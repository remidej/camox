// PROTOTYPE, throwaway (issue #520): packs the Template's src/ and Tailwind's CSS into site.json.
// The Theme drops its @fontsource import, as decided in #518 (fonts come from Google Fonts).
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const tpl = new URL("../../../template-default/src/", import.meta.url).pathname;
const tw = new URL("./node_modules/tailwindcss/", import.meta.url).pathname;
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));

const src = {};
for (const f of walk(tpl)) {
  if (!/\.(tsx?|css)$/.test(f) || f.endsWith(".d.ts")) continue;
  src[relative(tpl, f)] = readFileSync(f, "utf8");
}
src["styles.css"] = src["styles.css"].replace(/^@import "@fontsource[^\n]*\n/m, "");
const tailwind = Object.fromEntries(["index.css", "theme.css", "preflight.css", "utilities.css"].map((f) => [f, readFileSync(tw + f, "utf8")]));
writeFileSync("site.json", JSON.stringify({ src, tailwind }));
console.log(Object.keys(src).length, "site files;", Object.keys(src).filter((f) => !f.endsWith(".css")).map((f) => src[f].length).reduce((a, b) => a + b), "bytes of TS/TSX");
