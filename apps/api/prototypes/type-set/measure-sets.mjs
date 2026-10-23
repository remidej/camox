// PROTOTYPE, throwaway (#556). Checks the Template's src/ against each type set with tsrs.
// node measure-sets.mjs <site> out/a.json out/b.json ...
import fs from "node:fs";
import { check, workingCopy } from "./check.mjs";

const [site, ...sets] = process.argv.slice(2);
const wc = workingCopy(site);
for (const set of sets) {
  const typeSet = JSON.parse(fs.readFileSync(set, "utf8"));
  const files = { ...typeSet, ...wc };
  check(files); // compile + warm the module once
  const runs = [check(files), check(files), check(files)];
  const r = runs[1];
  console.log(set, JSON.stringify({ ms: runs.map((x) => x.ms), linearMiB: r.linearMiB, reads: r.reads, typeSetFiles: Object.keys(typeSet).length, diagnostics: r.diagnostics.slice(0, 3), stderr: r.stderr }));
}
