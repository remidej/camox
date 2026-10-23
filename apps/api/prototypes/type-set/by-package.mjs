// PROTOTYPE, throwaway (#556). Groups a `tsgo --listFiles` output by package, with sizes.
// node by-package.mjs site/files.txt
import fs from "node:fs";
const list = fs.readFileSync(process.argv[2], "utf8").trim().split("\n").filter((l) => l.startsWith("/"));
const groups = {};
for (const f of list) {
  const m = f.match(/node_modules\/\.pnpm\/[^/]+\/node_modules\/((?:@[^/]+\/)?[^/]+)\//) ?? f.match(/node_modules\/((?:@[^/]+\/)?[^/]+)\//);
  const key = f.includes("@typescript/native-preview") ? "(TS lib, bundled in tsrs)" : m ? m[1] : "(site)";
  const g = (groups[key] ??= { files: 0, bytes: 0 });
  g.files++;
  g.bytes += fs.statSync(f).size;
}
const rows = Object.entries(groups).sort((a, b) => b[1].bytes - a[1].bytes);
let tf = 0, tb = 0;
for (const [k, g] of rows) {
  tf += g.files; tb += g.bytes;
  console.log(String(g.files).padStart(5), (g.bytes / 1024).toFixed(0).padStart(7), "KiB ", k);
}
console.log(String(tf).padStart(5), (tb / 1024).toFixed(0).padStart(7), "KiB  total");
