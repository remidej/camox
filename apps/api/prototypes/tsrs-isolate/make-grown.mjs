// Slim set plus N copies of every file under src/ (a site N+1 times the Template's size).
import fs from "node:fs";
const [, , n, out] = process.argv;
const files = JSON.parse(fs.readFileSync("slim.txt", "utf8"));
const src = Object.entries(files).filter(([k]) => /\/project\/src\/(blocks|components)\//.test(k));
for (let i = 1; i <= +n; i++) for (const [k, v] of src) files[k.replace(/\/([^/]+)$/, `/copy${i}-$1`)] = v;
fs.writeFileSync(out, JSON.stringify(files));
