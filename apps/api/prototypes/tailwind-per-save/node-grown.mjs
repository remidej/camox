// PROTOTYPE, throwaway (issue #520): Node timings for site-<n>.json.
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { draftCss, extract } from "./tailwind-per-save.js";
for (const n of process.argv.slice(2)) {
  const { src, tailwind } = JSON.parse(readFileSync(`site-${n}.json`, "utf8"));
  const code = Object.entries(src).filter(([f]) => !f.endsWith(".css"));
  const byFile = new Map(code.map(([f, c]) => [f, extract(c)]));
  const runs = [];
  let css;
  for (let i = 0; i < 15; i++) {
    const t = performance.now();
    byFile.set("blocks/hero.tsx", extract(src["blocks/hero.tsx"] + ` "p-${i} m-${i}"`));
    css = await draftCss(src["styles.css"], tailwind, byFile);
    runs.push(performance.now() - t);
  }
  runs.sort((a, b) => a - b);
  const rules = css.split("\n").filter((l) => /^\s*\.[^ ]/.test(l) && l.trim().endsWith("{")).length;
  console.log(`${n}x: ${code.length} files, ${(code.reduce((a, [, c]) => a + c.length, 0) / 1024).toFixed(0)} KiB, ${rules} rules, ${(css.length / 1024).toFixed(0)} KiB CSS, save median ${runs[7].toFixed(1)} ms (min ${runs[0].toFixed(1)}, max ${runs[14].toFixed(1)}), heap ${(process.memoryUsage().heapUsed / 1048576).toFixed(0)} MiB`);
}
