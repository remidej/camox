// PROTOTYPE, throwaway (#556). One revision check with tsrs: a type set plus the working
// copy's src/, optionally scoped to some root files. Shared by the scripts below.
import fs from "node:fs";
import path from "node:path";
import { runTsc, memoryFileSystem, makeRequest, parseReply } from "@tsrs/wasm/core";

const wasmPath = path.join(import.meta.dirname, "node_modules/@tsrs/wasm/tsrs.wasm");
export const tsrs = new WebAssembly.Module(fs.readFileSync(wasmPath));

/** src/ of a site directory as { "/project/src/...": text }, plus its tsconfig.json. */
export function workingCopy(site) {
  const out = {};
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(tsx?|css)$/.test(e.name)) out["/project/" + path.relative(site, p)] = fs.readFileSync(p, "utf8");
    }
  };
  walk(path.join(site, "src"));
  out["/project/tsconfig.json"] = fs.readFileSync(path.join(site, "tsconfig.json"), "utf8");
  return out;
}

/**
 * Checks `files` (type set + working copy). `roots`: null for all of src/, or a list of
 * "/project/src/..." paths to give as `files` (the ambient ones are always added).
 */
export function check(files, roots = null) {
  const tsconfig = JSON.parse(files["/project/tsconfig.json"]);
  delete tsconfig.include; delete tsconfig.exclude;
  if (roots) {
    const ambient = Object.keys(files).filter((p) => p.startsWith("/project/src/") && p.endsWith(".d.ts"));
    tsconfig.files = [...new Set([...ambient, ...roots])];
  } else tsconfig.include = ["src/**/*.ts", "src/**/*.tsx"];
  const mem = memoryFileSystem({ ...files, "/project/tsconfig.json": JSON.stringify(tsconfig) });
  const reads = new Set();
  const hostErrors = [];
  const fsHost = {
    ...mem,
    written: mem.written,
    readFile: (p) => { const r = mem.readFile(p); reads.add(p); return r; },
    stat: (p) => mem.stat(p), readDir: (p) => mem.readDir(p), realpath: (p) => mem.realpath(p),
    writeFile: (...a) => mem.writeFile(...a), remove: (p) => mem.remove(p), chtimes: (...a) => mem.chtimes(...a),
  };
  const req = makeRequest(["-p", "/project/tsconfig.json"], { cwd: "/project", json: true });
  let stderr = "";
  const t0 = performance.now();
  const r = runTsc(tsrs, req, fsHost, { stderr: (c) => (stderr += new TextDecoder().decode(c)) });
  const ms = Math.round(performance.now() - t0);
  const diags = r.exitCode === 5 ? [] : parseReply(r.reply);
  return {
    ms,
    exitCode: r.exitCode,
    linearMiB: +(r.memoryBytes / 1048576).toFixed(1),
    reads: reads.size,
    srcReads: [...reads].filter((p) => p.startsWith("/project/src/")).length,
    diagnostics: diags.map((d) => `${d.fileName?.replace("/project/", "")}:${(d.startPosition?.line ?? 0) + 1} TS${d.code} ${d.text}`),
    stderr: stderr.slice(0, 300) || undefined,
    hostErrors,
  };
}
