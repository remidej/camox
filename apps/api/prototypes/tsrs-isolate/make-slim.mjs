// Lower bound for slim camox types: @camox/api-contract's index.d.ts reduced to `any` stubs.
import fs from "node:fs";
const files = JSON.parse(fs.readFileSync("files-full.txt", "utf8"));
const p = "/project/node_modules/@camox/api-contract/dist/index.d.ts";
const names = [...files[p].matchAll(/export \{([^}]*)\}/g)].flatMap((m) => m[1].split(","))
  .map((s) => s.trim()).filter(Boolean)
  .map((s) => { const isType = s.startsWith("type "); const n = s.replace(/^type /, "").split(" as ").pop().trim(); return { n, isType }; });
files[p] = names.map(({ n, isType }) => isType ? `export type ${n} = any;` : `export declare const ${n}: any;\nexport type ${n} = any;`).join("\n") + "\n";
fs.writeFileSync("slim-all.txt", JSON.stringify(files));
console.log(names.length, "exports stubbed");
