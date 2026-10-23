// PROTOTYPE, throwaway (#556). Copies a site and swaps in this repo's freshly built
// `camox` and `@camox/api-contract` dists (as if published), to measure slim types.
// node swap-sdk.mjs <fromSite> <toSite> [contractDistDir]
import fs from "node:fs";
import path from "node:path";
const [from, to, contractDist] = process.argv.slice(2);
const repo = path.resolve(import.meta.dirname, "../../../..");
fs.rmSync(to, { recursive: true, force: true });
fs.cpSync(from, to, { recursive: true, verbatimSymlinks: true });
for (const [name, src, dist] of [
  ["camox", "packages/sdk", "packages/sdk/dist"],
  ["@camox/api-contract", "packages/api-contract", contractDist ?? "packages/api-contract/dist"],
]) {
  const pnpm = path.join(to, "node_modules/.pnpm");
  const store = fs.readdirSync(pnpm).filter((d) => d.startsWith(name.replace("/", "+") + "@"));
  for (const s of store) {
    const dir = path.join(pnpm, s, "node_modules", name);
    fs.rmSync(path.join(dir, "dist"), { recursive: true, force: true });
    fs.cpSync(path.resolve(repo, dist), path.join(dir, "dist"), { recursive: true });
    const pkg = JSON.parse(fs.readFileSync(path.join(repo, src, "package.json"), "utf8"));
    pkg.exports = pkg.publishConfig.exports;
    fs.rmSync(path.join(dir, "package.json"));
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(pkg, null, 2));
    console.log("swapped", dir.replace(to, ""));
  }
}
