// Same check in Node, but with the clock frozen as in Workers.
import fs from "node:fs";
const frozen = performance.now();
performance.now = () => frozen;
Date.now = () => 1700000000000;
const { runBench } = await import("./bench.js");
const files = JSON.parse(fs.readFileSync("files-full.txt", "utf8"));
const c = runBench(new WebAssembly.Module(fs.readFileSync("tsrs.wasm")), files, ["cold"]).cold;
console.log(c.readCount, "reads", c.linearMiB, "MiB", c.diagnostics, "diags", c.first[0]?.text ?? "");
