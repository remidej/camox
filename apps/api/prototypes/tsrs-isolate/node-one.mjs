import fs from "node:fs";
globalThis.KEEP_READS = true;
const { runBench } = await import("./bench.js");
const files = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const module = new WebAssembly.Module(fs.readFileSync("tsrs.wasm"));
runBench(module, files, ["cold"]);
const r = runBench(module, files, process.argv[4]?.split(",") ?? ["cold", "edit", "error"]);
for (const [k, v] of Object.entries(r)) console.log(k, v.ms, "ms", v.linearMiB, "MiB", v.readCount, "reads", v.diagnostics, "diags", v.first?.[0]?.text ?? "");
if (process.argv[3]) { const keep = new Set(r.cold.reads); keep.add("/project/tsconfig.json");
  for (const k of Object.keys(files)) if (!keep.has(k) && !k.endsWith("package.json")) delete files[k];
  fs.writeFileSync(process.argv[3], JSON.stringify(files)); console.log("wrote", Object.keys(files).length, "files", (JSON.stringify(files).length/1048576).toFixed(1), "MiB"); }
