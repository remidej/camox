// PROTOTYPE, throwaway (issue #519): tsrs in a Durable Object, measured deployed.
import { DurableObject } from "cloudflare:workers";

import { runBench } from "./bench.js";
import setText from "./set.txt";
import wasm from "./tsrs.wasm";

let isolateId;
let runs = 0;
const sets = new Proxy({}, { get: () => setText });
let parsed = {};

export class Checker extends DurableObject {
  async fetch(request) {
    const url = new URL(request.url);
    const set = url.searchParams.get("set") ?? "full";
    const steps = (url.searchParams.get("steps") ?? "cold").split(",");
    parsed[set] ??= JSON.parse(sets[set]);
    globalThis.KEEP_READS = url.searchParams.has("reads");
    isolateId ??= crypto.randomUUID().slice(0, 8);
    runs++;
    const padMiB = +(url.searchParams.get("pad") ?? 0);
    const pad = new Uint8Array(padMiB * 1048576).fill(1);
    const t0 = Date.now();
    const result = runBench(wasm, parsed[set], steps);
    return Response.json({ isolateId, runsInIsolate: runs, set, totalMs: Date.now() - t0, result });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.searchParams.get("mode") === "jump") {
      const start = +url.searchParams.get("start"),
        delta = +url.searchParams.get("delta");
      const mem = new WebAssembly.Memory({ initial: start });
      new Uint8Array(mem.buffer).fill(1); // touch every page, as tsrs has
      try {
        mem.grow(delta);
        return Response.json({ start, delta, ok: true, pages: mem.buffer.byteLength / 65536 });
      } catch (e) {
        return Response.json({ start, delta, ok: false, err: String(e) });
      }
    }
    if (url.searchParams.get("mode") === "grow") {
      const mem = new WebAssembly.Memory({ initial: 1483 });
      let pages = 1483,
        err = null;
      try {
        while (pages < 8192) {
          mem.grow(16);
          pages += 16;
        }
      } catch (e) {
        err = String(e);
      }
      return Response.json({ maxPagesReached: pages, MiB: pages / 16, err });
    }
    if (url.searchParams.get("mode") === "worker") {
      globalThis.KEEP_READS = false;
      parsed.full ??= JSON.parse(sets.full);
      const r = runBench(wasm, parsed.full, ["cold"]).cold;
      return Response.json({ mode: "plain worker", ...r });
    }
    const name = new URL(request.url).searchParams.get("do") ?? "one";
    try {
      const t0 = Date.now();
      const res = await env.CHECKER.get(env.CHECKER.idFromName(name)).fetch(request);
      const body = await res.json();
      return Response.json({ wallMsSeenByCaller: Date.now() - t0, ...body });
    } catch (e) {
      return new Response(`DO error: ${e.message}`, { status: 500 });
    }
  },
};
