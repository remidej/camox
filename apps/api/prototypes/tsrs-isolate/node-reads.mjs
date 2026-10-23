import fs from "node:fs";
import { runBench } from "./bench.js";
globalThis.KEEP_READS = true;
const files = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const module = new WebAssembly.Module(fs.readFileSync("tsrs.wasm"));
const r = runBench(module, files, ["cold"]).cold;
fs.writeFileSync(process.argv[3], r.reads.join("\n") + "\n");
console.log(r.readCount, "reads", r.missCount, "misses", r.diagnostics, "diags");
