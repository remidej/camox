// PROTOTYPE, throwaway (issue #520): a site n times the Template's blocks and components. Each
// copy shifts the numbers in its classes (`gap-4` becomes `gap-7`), so copies add new utilities
// instead of repeating the Template's. Writes site-<n>.json.
import { readFileSync, writeFileSync } from "node:fs";
const n = +process.argv[2];
const { src, tailwind } = JSON.parse(readFileSync("site.json", "utf8"));
const out = { ...src };
for (let k = 1; k < n; k++)
  for (const [f, c] of Object.entries(src))
    if (/^(blocks|components)\//.test(f))
      out[f.replace(/\.tsx$/, `-${k}.tsx`)] = c.replace(/\b([a-z]+-(?:[a-z]+-)?)(\d+)\b/g, (_, p, d) => p + ((+d + k) % 97));
writeFileSync(`site-${n}.json`, JSON.stringify({ src: out, tailwind }));
