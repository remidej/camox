import fs from "node:fs";
globalThis.KEEP_READS = true; globalThis.MEMLOG = true;
const { runBench } = await import("./bench.js");
const files = JSON.parse(fs.readFileSync("files-full.txt", "utf8"));
const r = runBench(new WebAssembly.Module(fs.readFileSync("tsrs.wasm")), files, ["cold"]).cold;
fs.writeFileSync("/tmp/memlog-node.txt", r.log.join("\n") + "\n");
