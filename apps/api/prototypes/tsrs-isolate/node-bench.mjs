// PROTOTYPE, throwaway. node node-bench.mjs files.json [tsrs.wasm]
import fs from "node:fs";
import { runBench } from "./bench.js";

const files = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const wasm = process.argv[3] ?? "node_modules/@tsrs/wasm/tsrs.wasm";
const module = new WebAssembly.Module(fs.readFileSync(wasm));
runBench(module, files, ["cold"]); // warm up V8's compile of the module
console.log(JSON.stringify(runBench(module, files), null, 1));
console.log("node rss MiB", Math.round(process.memoryUsage().rss / 1048576));
