// PROTOTYPE, throwaway (issue #521): the DO's operations in Node, for memory.
// node --expose-gc node-bench.mjs <scenario> <repo>   (needs `cf` signed in)
// Memory is V8's heap plus external memory (ArrayBuffers), the closest Node gets to an isolate's
// share of the 128 MB limit: peak while running, and retained afterwards with the clone held.
import { execFileSync } from "node:child_process";

import { cloneBranch, mergeMain, turn } from "./ops.js";

const [scenario, repo] = process.argv.slice(2);
const cf = (...args) => JSON.parse(execFileSync("cf", args, { encoding: "utf8" }));
const { remote } = cf("artifacts", "namespaces", "repos", "get", repo, "--namespace", "prototype-521");
const { plaintext: token } = cf("artifacts", "namespaces", "tokens", "create", "prototype-521", "--repo", repo, "--scope", "write", "--ttl", "600");

const MiB = (n) => +(n / 2 ** 20).toFixed(1);
const used = () => {
  const m = process.memoryUsage();
  return m.heapUsed + m.external;
};
gc();
const baseline = used();
let peak = 0;
const timer = setInterval(() => (peak = Math.max(peak, used())), 2);
const label = `${scenario}-${Date.now()}`;

const out = {};
let held;
if (scenario === "turn" || scenario === "merge" || scenario === "conflict") {
  const branch = scenario === "conflict" ? "draft-conflict" : "draft";
  const c = await cloneBranch(remote, token, branch, 1);
  const depths = process.env.DEPTHS ? (([d, m]) => ({ draftDepth: +d, mainDepth: +m }))(process.env.DEPTHS.split(",")) : {};
  held = c;
  out.clone = { ms: c.ms, files: c.files, MiB: MiB(c.bytes), gitMiB: MiB(c.gitBytes), peakMiB: MiB(peak - baseline) };
  if (scenario === "turn") out.turn = await turn(c.fs, remote, token, branch, { label, cache: c.cache, remoteRef: `bench/${label}` });
  else out.merge = await mergeMain(c.fs, remote, token, branch, { cache: c.cache, remoteRef: `bench/${label}`, ...depths });
} else if (scenario === "full") {
  held = await cloneBranch(remote, token, "draft", undefined);
  out.fullClone = { ms: held.ms, files: held.files, gitMiB: MiB(held.gitBytes) };
}
await new Promise((r) => setTimeout(r, 10));
clearInterval(timer);
gc();
out.memory = { peakMiB: MiB(peak - baseline), retainedMiB: MiB(used() - baseline) };
console.log(JSON.stringify({ repo, scenario, ...out, held: !!held }));
