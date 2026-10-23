// PROTOTYPE, throwaway (issue #521): what a draft's Durable Object does with its working copy.
// Shared by worker.js (deployed DO, timings) and node-bench.mjs (Node, memory).
import git from "isomorphic-git";
import http from "isomorphic-git/http/web";

import { MemoryFs } from "../../src/lib/memory-fs.ts";

export const DIR = "/repo";
const AUTHOR = { name: "Camox", email: "noreply@camox.ai" };
const now = () => performance.now();

const remoteOptions = (fs, url, token) => ({
  fs,
  http,
  dir: DIR,
  url,
  headers: { Authorization: `Bearer ${token}` },
});

/** What's in a MemoryFs: the working tree's files and bytes, and .git's. */
export async function sizes(fs) {
  const out = { files: 0, bytes: 0, gitFiles: 0, gitBytes: 0 };
  const walk = async (path) => {
    for (const name of await fs.promises.readdir(path)) {
      const p = `${path}/${name}`;
      const st = await fs.promises.lstat(p);
      const isGit = p.startsWith(`${DIR}/.git`);
      if (st.isDirectory()) await walk(p);
      else if (isGit) (out.gitFiles++, (out.gitBytes += st.size));
      else (out.files++, (out.bytes += st.size));
    }
  };
  await walk(DIR);
  return out;
}

/** Clones one branch. depth: 1 for the working copy only; undefined for its whole history. */
export async function cloneBranch(url, token, branch, depth) {
  const fs = new MemoryFs();
  const cache = {};
  const t0 = now();
  await git.clone({
    ...remoteOptions(fs, url, token),
    ref: branch,
    singleBranch: true,
    depth,
    noTags: true,
    cache,
  });
  const ms = now() - t0;
  return { fs, cache, ms, ...(await sizes(fs)) };
}

/** One agent turn: edits `edits` files, adds one block, commits and pushes to `branch`. */
export async function turn(
  fs,
  url,
  token,
  branch,
  { edits = 3, label = Date.now(), cache = {}, remoteRef = branch } = {},
) {
  const t0 = now();
  const files = (await git.listFiles({ fs, dir: DIR, cache })).filter((f) =>
    /^src\/blocks\/.*\.tsx$/.test(f),
  );
  const changed = files.slice(0, edits);
  for (const filepath of changed) {
    const path = `${DIR}/${filepath}`;
    const text = await fs.promises.readFile(path, { encoding: "utf8" });
    await fs.promises.writeFile(path, `${text}\n/* agent ${label} */\n`);
  }
  const added = `src/blocks/agent-${label}.tsx`;
  await fs.promises.writeFile(
    `${DIR}/${added}`,
    `export const block = ${JSON.stringify(String(label))};\n`,
  );
  for (const filepath of [...changed, added]) await git.add({ fs, dir: DIR, filepath, cache });
  const oid = await git.commit({
    fs,
    dir: DIR,
    message: `Agent turn ${label}`,
    author: AUTHOR,
    cache,
  });
  const tCommit = now();
  const res = await git.push({
    ...remoteOptions(fs, url, token),
    ref: branch,
    remoteRef,
    cache,
    force: remoteRef !== branch,
  });
  return {
    oid,
    commitMs: tCommit - t0,
    pushMs: now() - tCommit,
    ok: res.ok,
    changed: changed.length + 1,
  };
}

/**
 * Merges main into `branch` in a shallow clone of `branch`: fetches main, deepening both until
 * they share a commit, then merges and pushes. Returns the conflicts instead of committing them.
 */
export async function mergeMain(
  fs,
  url,
  token,
  branch,
  { cache = {}, remoteRef = branch, draftDepth, mainDepth } = {},
) {
  const t0 = now();
  const opts = { ...remoteOptions(fs, url, token), singleBranch: true, tags: false, cache };
  let depth = 1;
  let base = [];
  let fetches = 0;
  const fetchLog = [];
  const timed = async (ref, d) => {
    const t = now();
    await git.fetch({ ...opts, ref, depth: d });
    fetches++;
    fetchLog.push(`${ref}@${d}:${Math.round(now() - t)}ms`);
  };
  // Known depths (the DO counts its turns since the last merge): one fetch each.
  if (draftDepth) await timed(branch, draftDepth);
  await timed("main", mainDepth ?? depth);
  const ours = await git.resolveRef({ fs, dir: DIR, ref: branch });
  const theirs = await git.resolveRef({ fs, dir: DIR, ref: "refs/remotes/origin/main" });
  for (;;) {
    try {
      base = await git.findMergeBase({ fs, dir: DIR, oids: [ours, theirs], cache });
    } catch (e) {
      base = [];
      if (e.code !== "NotFoundError") throw e;
    }
    if (base.length) break;
    depth = depth * 4;
    if (depth > 100_000) throw new Error("no merge base");
    await timed("main", depth);
    await timed(branch, depth);
  }
  const tFetch = now();
  let result;
  try {
    result = await git.merge({
      fs,
      dir: DIR,
      ours: branch,
      theirs,
      author: AUTHOR,
      message: "Merge main",
      cache,
      abortOnConflict: true,
    });
  } catch (e) {
    if (e.code !== "MergeConflictError") throw e;
    return {
      conflict: e.data?.filepaths ?? e.message,
      depth,
      fetches,
      fetchLog,
      fetchMs: tFetch - t0,
      mergeMs: now() - tFetch,
      ...(await sizes(fs)),
    };
  }
  const tMerge = now();
  await git.checkout({ fs, dir: DIR, ref: branch, cache, force: true });
  const tCheckout = now();
  const res = await git.push({
    ...remoteOptions(fs, url, token),
    ref: branch,
    remoteRef,
    cache,
    force: remoteRef !== branch,
  });
  return {
    oid: result.oid,
    fastForward: !!result.fastForward,
    depth,
    fetches,
    fetchLog,
    fetchMs: tFetch - t0,
    mergeMs: tMerge - tFetch,
    checkoutMs: tCheckout - tMerge,
    pushMs: now() - tCheckout,
    ok: res.ok,
    ...(await sizes(fs)),
  };
}

/** The working tree straight from the Artifacts binding, without Git: readTree + readBlob. */
export async function loadFromBinding(repo, branch) {
  const t0 = now();
  const [head] = await repo.log({ ref: branch, limit: 1 });
  const files = new Map();
  const walk = async (hash, prefix) => {
    const entries = await repo.readTree(hash);
    await Promise.all(
      entries.map(async (e) => {
        if (e.type === "tree") return walk(e.hash, `${prefix}${e.name}/`);
        const blob = await repo.readBlob(e.hash);
        files.set(`${prefix}${e.name}`, new Uint8Array(await blob.arrayBuffer()));
      }),
    );
  };
  await walk(head.treeHash, "");
  let bytes = 0;
  for (const data of files.values()) bytes += data.byteLength;
  return { files, ms: now() - t0, count: files.size, bytes, head: head.hash };
}
