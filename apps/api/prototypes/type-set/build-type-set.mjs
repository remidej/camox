// PROTOTYPE, throwaway (#556). Builds a type set: every declaration file a revision's check
// may read outside the working copy, as one { virtualPath: text } map.
//
// node build-type-set.mjs <site> <mode> <out.json>
//   mode "reach":   what the site's current src/ reads (tsgo --listFiles), nothing more
//   mode "all":     every types entry of every runtime dependency, every site-facing `camox`
//                   entry, @types/react(-dom) and the tsconfig's `types`
//   mode "entries": no output; prints what each `camox` entry adds on top of React alone
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { gzipSync, brotliCompressSync, constants } from "node:zlib";

const [siteArg, mode, outFile] = process.argv.slice(2);
const site = path.resolve(siteArg);
const tsgo = path.join(site, "node_modules/.bin/tsgo");
const pkg = JSON.parse(fs.readFileSync(path.join(site, "package.json"), "utf8"));

// Packages a site's src/ never imports: build tooling and CSS-only packages.
const NOT_FOR_SRC = new Set(["@tailwindcss/vite", "tailwindcss", "@fontsource-variable/hanken-grotesk"]);
// `camox` entries meant for src/. The rest are for the Vite config, the runtime or the studio.
const CAMOX_SITE_ENTRIES = ["createBlock", "createLayout", "createCollection", "document", "navigation", "dom"];

function listFiles(specifiers) {
  const probe = path.join(site, "__probe__.ts");
  fs.writeFileSync(probe, specifiers.map((s, i) => `import type * as m${i} from ${JSON.stringify(s)};`).join("\n") + "\nexport {};\n");
  const tsconfig = path.join(site, "tsconfig.probe.json");
  fs.writeFileSync(tsconfig, JSON.stringify({ extends: "./tsconfig.json", include: [], files: ["__probe__.ts"] }));
  let out;
  try {
    out = execFileSync(tsgo, ["-p", tsconfig, "--listFiles", "--noUnusedLocals", "false"], { cwd: site, encoding: "utf8" });
  } catch (e) {
    out = e.stdout; // errors (e.g. an export with no types) still list files
    const errs = out.split("\n").filter((l) => l.includes("error TS"));
    if (errs.length) console.error(errs.length, "probe errors, first:", errs[0]);
  }
  fs.rmSync(probe); fs.rmSync(tsconfig);
  return out.split("\n").filter((l) => l.startsWith("/") && !l.endsWith("__probe__.ts"));
}

function typesSubpaths(name) {
  const dir = path.join(site, "node_modules", name);
  const p = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
  if (!p.exports || typeof p.exports === "string") return [name];
  const keys = Object.keys(p.exports).filter((k) => k.startsWith("."));
  if (!keys.length) return [name];
  return keys
    .filter((k) => !k.includes("*") && !k.endsWith(".json") && !k.endsWith(".css"))
    .map((k) => (k === "." ? name : name + k.slice(1)));
}

const isLib = (f) => f.includes("@typescript/native-preview");

if (mode === "entries") {
  const base = new Set(listFiles(["react", "react/jsx-runtime"]));
  const camoxEntries = typesSubpaths("camox").filter((s) => !s.endsWith(".css"));
  for (const e of camoxEntries) {
    const files = listFiles(["react", "react/jsx-runtime", e]).filter((f) => !base.has(f) && !isLib(f));
    const bytes = files.reduce((a, f) => a + fs.statSync(f).size, 0);
    const router = files.some((f) => f.includes("api-contract/dist/router"));
    console.log(String(files.length).padStart(5), "files", (bytes / 1024).toFixed(0).padStart(6), "KiB", router ? " ROUTER" : "       ", e);
  }
  process.exit(0);
}

let files;
if (mode === "reach") {
  files = execFileSync(tsgo, ["-p", "tsconfig.check.json", "--listFiles"], { cwd: site, encoding: "utf8" })
    .split("\n").filter((l) => l.startsWith("/") && l.includes("/node_modules/"));
} else {
  const specs = ["react", "react/jsx-runtime", "react-dom", "react-dom/client"];
  for (const name of Object.keys(pkg.dependencies)) {
    if (NOT_FOR_SRC.has(name)) continue;
    if (name === "camox") specs.push(...CAMOX_SITE_ENTRIES.map((e) => `camox/${e}`));
    else specs.push(...typesSubpaths(name));
  }
  console.error("probing", specs.length, "specifiers:", specs.join(" "));
  files = listFiles(specs).filter((f) => f.includes("/node_modules/"));
}
files = files.filter((f) => !isLib(f)); // tsrs bundles TypeScript's lib files

// Flatten pnpm's store into /project/node_modules/<name>/..., keeping each package.json.
const out = {};
const versions = {};
for (const f of files) {
  const m = f.match(/^(.*\/node_modules\/\.pnpm\/([^/]+)\/node_modules\/((?:@[^/]+\/)?[^/]+))\/(.*)$/);
  if (!m) throw new Error("not in the pnpm store: " + f);
  const [, root, store, name, rest] = m;
  (versions[name] ??= new Set()).add(store);
  out[`/project/node_modules/${name}/${rest}`] = fs.readFileSync(f, "utf8");
  out[`/project/node_modules/${name}/package.json`] = fs.readFileSync(path.join(root, "package.json"), "utf8");
}
for (const [n, s] of Object.entries(versions)) if (s.size > 1) console.error("DUPLICATE VERSIONS", n, [...s]);

const json = JSON.stringify(out);
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, json);
const t0 = performance.now(); JSON.parse(json); const parseMs = performance.now() - t0;
const buf = Buffer.from(json);
const pkgs = Object.keys(versions).length;
console.log(JSON.stringify({
  mode, packages: pkgs, files: Object.keys(out).length,
  MiB: +(buf.length / 1048576).toFixed(2),
  gzipMiB: +(gzipSync(buf, { level: 9 }).length / 1048576).toFixed(2),
  brotliMiB: +(brotliCompressSync(buf, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length / 1048576).toFixed(2),
  jsonParseMs: Math.round(parseMs),
}));
