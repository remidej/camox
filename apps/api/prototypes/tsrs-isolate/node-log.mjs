import fs from "node:fs";
import { runBench } from "./bench.js";
globalThis.KEEP_READS = true;
const files = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const r = runBench(new WebAssembly.Module(fs.readFileSync("tsrs.wasm")), files, ["cold"]).cold;
fs.writeFileSync(process.argv[3], r.log.join("\n") + "\n");
