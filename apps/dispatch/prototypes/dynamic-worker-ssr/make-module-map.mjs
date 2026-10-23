// PROTOTYPE (#522): turn apps/landing's server build into a module map for the Worker Loader.
// Run `CAMOX_INTERNAL_RELEASE=dry-run npx vp build` in apps/landing first.
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

const dist = new URL("../../../landing/dist/camox_landing/", import.meta.url).pathname;
const out = new URL("./bundle/", import.meta.url).pathname;
await mkdir(out, { recursive: true });

const modules = {};
const wasm = [];
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (entry.name.endsWith(".js")) modules[relative(dist, path)] = { js: await readFile(path, "utf8") };
    else if (entry.name.endsWith(".wasm")) wasm.push(relative(dist, path));
  }
}
await walk(dist);
await writeFile(join(out, "modules.json"), JSON.stringify({ modules, wasm }));
for (const name of wasm) await writeFile(join(out, name.replaceAll("/", "__")), await readFile(join(dist, name)));
const jsBytes = Object.values(modules).reduce((n, m) => n + m.js.length, 0);
console.log(`${Object.keys(modules).length} JS modules (${(jsBytes / 2 ** 20).toFixed(2)} MiB), wasm: ${wasm.join(", ")}`);
