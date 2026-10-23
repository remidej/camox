// PROTOTYPE, throwaway. Measures tsrs checking a hosted site's src/ (issue #519).
// Shared by node-bench.mjs and the Durable Object in worker.js.
import { runTsc, memoryFileSystem, makeRequest, parseReply } from "@tsrs/wasm/core";

const MiB = (n) => +(n / 1048576).toFixed(1);
const HERO = "/project/src/blocks/hero.tsx";
const BUILDINFO = "/project/.tsbuildinfo";

function check(module, files, extraArgs = []) {
  const mem = memoryFileSystem(files);
  const reads = new Set(),
    misses = new Set();
  const log = [];
  const memRef = {};
  const wrap =
    (op, fn) =>
    (...a) => {
      try {
        const r = fn(...a);
        log.push(
          (globalThis.MEMLOG && memRef.m
            ? Math.round(memRef.m.buffer.byteLength / 65536) + "p "
            : "") +
            op +
            " " +
            a[0] +
            (op === "stat"
              ? " " + r.kind
              : op === "readDir"
                ? " " + r.length
                : op === "realpath"
                  ? " -> " + r
                  : ""),
        );
        if (op === "readFile") reads.add(a[0]);
        return r;
      } catch (e) {
        log.push(op + " " + a[0] + " ERR " + e.constructor.name);
        if (op === "readFile") misses.add(a[0]);
        throw e;
      }
    };
  const fs = {
    written: mem.written,
    readFile: wrap("readFile", (p) => mem.readFile(p)),
    stat: wrap("stat", (p) => mem.stat(p)),
    readDir: wrap("readDir", (p) => mem.readDir(p)),
    realpath: wrap("realpath", (p) => mem.realpath(p)),
    writeFile: (...a) => mem.writeFile(...a),
    remove: (p) => mem.remove(p),
    chtimes: (...a) => mem.chtimes(...a),
  };
  const req = makeRequest(["-p", "/project/tsconfig.json", ...extraArgs], {
    cwd: "/project",
    json: true,
  });
  let stderr = "";
  const t0 = performance.now();
  const r = runTsc(module, req, fs, {
    stderr: (c) => (stderr += new TextDecoder().decode(c)),
    beforeRun: (m) => (memRef.m = m),
  });
  const ms = Math.round(performance.now() - t0);
  const diags = r.exitCode === 5 ? [] : parseReply(r.reply);
  return {
    ms,
    exitCode: r.exitCode,
    linearMiB: MiB(r.memoryBytes),
    diagnostics: diags.length,
    first: diags.slice(0, 3).map((d) => ({
      file: d.fileName,
      line: d.startPosition?.line,
      code: d.code,
      text: d.text,
    })),
    stderr: stderr.slice(0, 500) || undefined,
    hostErrors: (globalThis.TSRS_HOST_ERRORS ?? []).splice(0).slice(0, 5),
    written: fs.written,
    reads: [...reads].sort(),
    lastReads: [...reads].slice(-4),
    log,
    readCount: reads.size,
    missCount: misses.size,
  };
}

const strip = ({ written, reads, log, ...rest }) =>
  globalThis.KEEP_READS ? { ...rest, reads, log } : rest;

/** Runs the steps named in `steps`, each a fresh tsrs instance. */
export function runBench(module, files, steps = ["cold", "edit", "error", "incremental"]) {
  const out = {};
  const edited = { ...files, [HERO]: (files[HERO] ?? "").replace("export", "// edited\nexport") };
  const broken = {
    ...files,
    [HERO]: (files[HERO] ?? "") + "\nexport const oops: number = 'not a number';\n",
  };
  for (const step of steps) {
    if (step === "cold") out.cold = strip(check(module, files));
    if (step === "edit") out.edit = strip(check(module, edited));
    if (step === "error") out.error = strip(check(module, broken));
    if (step === "incremental") {
      const args = ["--incremental", "--tsBuildInfoFile", BUILDINFO];
      const first = check(module, files, args);
      const info = first.written.get(BUILDINFO);
      const second = check(module, info ? { ...broken, [BUILDINFO]: info } : broken, args);
      out.incremental = {
        first: strip(first),
        buildInfoKiB: info ? Math.round(info.length / 1024) : null,
        afterEdit: strip(second),
      };
    }
  }
  return out;
}
