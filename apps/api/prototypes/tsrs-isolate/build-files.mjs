// Builds files.json: the virtual tree a hosted site's src/ check reads.
import fs from "node:fs";
const list = fs.readFileSync(process.argv[2], "utf8").trim().split("\n");
const root = "/tmp/tpl/", real = fs.realpathSync(root);
const out = {}, pkgVersions = {};
const add = (virt, realPath) => { out[virt] = fs.readFileSync(realPath, "utf8"); };
for (const f of list) {
  if (f.includes("/@typescript/native-preview")) continue; // TS libs: tsrs bundles its own
  const m = f.match(/^(.*\/node_modules\/\.pnpm\/([^/]+)\/node_modules\/((?:@[^/]+\/)?[^/]+))\/(.*)$/);
  if (m) {
    const [, pkgRoot, store, name, rest] = m;
    (pkgVersions[name] ??= new Set()).add(store);
    add(`/project/node_modules/${name}/${rest}`, f);
    add(`/project/node_modules/${name}/package.json`, `${pkgRoot}/package.json`);
  } else {
    add("/project/" + f.replace(real + "/", "").replace(root, ""), f);
  }
}
for (const [n, s] of Object.entries(pkgVersions)) if (s.size > 1) console.error("DUPLICATE", n, [...s]);
const tsconfig = JSON.parse(fs.readFileSync(root + "tsconfig.json", "utf8"));
tsconfig.include = ["src/**/*.ts", "src/**/*.tsx"];
out["/project/tsconfig.json"] = JSON.stringify(tsconfig);
fs.writeFileSync(process.argv[3], JSON.stringify(out));
const bytes = Object.values(out).reduce((a, s) => a + s.length, 0);
console.log(Object.keys(out).length, "files,", (bytes / 1048576).toFixed(1), "MiB");
