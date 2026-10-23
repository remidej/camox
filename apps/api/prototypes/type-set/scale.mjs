// PROTOTYPE, throwaway (#556). How big do importer cones get as a site grows, and what does
// checking a cone cost? Grows the Template like #519 did: N extra copies of every block and
// component, all importing the original shared ones (lib/utils, components/ui/*).
// node scale.mjs <site> <typeSet.json> <N,...> [batchSize]
import fs from "node:fs";
import { check, workingCopy } from "./check.mjs";
import { importGraph, transitiveImporters } from "./importers.mjs";

const [site, setPath, ns, batchArg] = process.argv.slice(2);
const typeSet = JSON.parse(fs.readFileSync(setPath, "utf8"));
const wc = workingCopy(site);
const batch = +(batchArg ?? 40);

for (const n of ns.split(",").map(Number)) {
  const files = { ...typeSet, ...wc };
  const copied = Object.entries(wc).filter(([k]) => /\/project\/src\/(blocks|components)\//.test(k));
  for (let i = 1; i <= n; i++) for (const [k, v] of copied) files[k.replace(/\/([^/]+)$/, `/copy${i}-$1`)] = v;
  const t0 = performance.now();
  const g = importGraph(files);
  const graphMs = (performance.now() - t0).toFixed(1);
  const cone = (p) => [...transitiveImporters(g, ["/project/src/" + p])];
  const cones = { utils: cone("lib/utils.ts"), section: cone("components/ui/section.tsx"), hero: cone("blocks/hero.tsx") };
  console.log(`== ${n + 1}x the Template: ${g.src.length} src files, graph built in ${graphMs} ms; cones: lib/utils ${cones.utils.length}, ui/section ${cones.section.length}, blocks/hero ${cones.hero.length}`);
  for (const [name, roots] of Object.entries(cones)) {
    if (roots.length <= batch) {
      const r = check(files, roots);
      console.log(`   ${name} cone in one check: ${r.ms} ms, ${r.linearMiB} MiB, ${r.diagnostics.length} diagnostics`);
    } else {
      const results = [];
      for (let i = 0; i < roots.length; i += batch) results.push(check(files, roots.slice(i, i + batch)));
      const ms = results.reduce((a, r) => a + r.ms, 0);
      const peak = Math.max(...results.map((r) => r.linearMiB));
      const one = check(files, roots);
      console.log(`   ${name} cone in ${results.length} checks of <=${batch} roots: ${ms} ms total, peak ${peak} MiB | in one check: ${one.ms} ms, ${one.linearMiB} MiB`);
    }
  }
}
