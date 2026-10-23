// PROTOTYPE, throwaway (issue #521): a draft's working copy in a deployed Durable Object.
// GET /?do=<name>&repo=tpl|grown|long&op=<op>[&depths=<draft>,<main>]
//   turn:    clone `draft` (depth 1) if not in memory, then one agent turn, pushed to bench/<do>
//   merge:   clone if needed, merge main into it (known depths, or deepening), push to bench/<do>
//   persist: save the MemoryFs (working tree + .git) to the DO's SQLite
//   restore: drop memory, rebuild the MemoryFs from SQLite
//   binding: read the draft's tree with the Artifacts binding instead of Git
//   full:    clone the draft's whole history
//   evict:   drop the in-memory copy
import { DurableObject } from "cloudflare:workers";

import { MemoryFs } from "../../src/lib/memory-fs.ts";
import { cloneBranch, loadFromBinding, mergeMain, sizes, turn } from "./ops.js";

let isolateId;
const ms = (t0) => Math.round(performance.now() - t0);

export class Draft extends DurableObject {
  copy; // { fs, cache, repo }
  constructor(ctx, env) {
    super(ctx, env);
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS nodes (path TEXT PRIMARY KEY, node TEXT, data BLOB)",
    );
  }
  async remote(name) {
    using repo = await this.env.ARTIFACTS.get(name);
    const { remote } = await repo.info();
    const { plaintext } = await repo.createToken("write", 600);
    return { remote, token: plaintext };
  }
  async fetch(request) {
    const url = new URL(request.url);
    const name = url.searchParams.get("repo") ?? "tpl";
    const op = url.searchParams.get("op") ?? "turn";
    const doName = url.searchParams.get("do") ?? "one";
    isolateId ??= crypto.randomUUID().slice(0, 8);
    const out = { isolateId, repo: name, op, warm: this.copy?.repo === name };
    const t0 = performance.now();
    const { remote, token } = await this.remote(name);
    out.tokenMs = ms(t0);
    const ensure = async () => {
      if (this.copy?.repo === name) return;
      const c = await cloneBranch(remote, token, "draft", 1);
      this.copy = { ...c, repo: name };
      out.clone = { ms: Math.round(c.ms), files: c.files, bytes: c.bytes, gitBytes: c.gitBytes };
    };
    const ref = `bench/${doName}-${Date.now()}`;
    if (op === "turn") {
      await ensure();
      out.turn = await turn(this.copy.fs, remote, token, "draft", {
        label: Date.now(),
        cache: this.copy.cache,
        remoteRef: ref,
      });
    } else if (op === "merge") {
      await ensure();
      const d = url.searchParams.get("depths")?.split(",").map(Number);
      out.merge = await mergeMain(this.copy.fs, remote, token, "draft", {
        cache: this.copy.cache,
        remoteRef: ref,
        ...(d && { draftDepth: d[0], mainDepth: d[1] }),
      });
    } else if (op === "persist") {
      await ensure();
      const t = performance.now();
      const sql = this.ctx.storage.sql;
      let bytes = 0;
      this.ctx.storage.transactionSync(() => {
        sql.exec("DELETE FROM nodes");
        for (const [path, node] of this.copy.fs.nodes) {
          const { data, ...rest } = node;
          if (data) bytes += data.byteLength;
          sql.exec("INSERT INTO nodes VALUES (?, ?, ?)", path, JSON.stringify(rest), data ?? null);
        }
      });
      out.persist = { ms: ms(t), rows: this.copy.fs.nodes.size, bytes };
    } else if (op === "restore") {
      const t = performance.now();
      const fs = new MemoryFs();
      for (const row of this.ctx.storage.sql.exec("SELECT path, node, data FROM nodes")) {
        const node = JSON.parse(row.node);
        if (row.data) node.data = new Uint8Array(row.data);
        fs.nodes.set(row.path, node);
      }
      this.copy = { fs, cache: {}, repo: name };
      out.restore = { ms: ms(t), ...(await sizes(fs)) };
    } else if (op === "binding") {
      using repo = await this.env.ARTIFACTS.get(name);
      const r = await loadFromBinding(repo, "draft");
      out.binding = { ms: Math.round(r.ms), files: r.count, bytes: r.bytes };
    } else if (op === "full") {
      const c = await cloneBranch(remote, token, "draft", undefined);
      out.full = { ms: Math.round(c.ms), files: c.files, gitBytes: c.gitBytes };
    } else if (op === "evict") {
      this.copy = undefined;
    }
    out.totalMs = ms(t0);
    return Response.json(out);
  }
}

export default {
  async fetch(request, env) {
    const name = new URL(request.url).searchParams.get("do") ?? "one";
    const t0 = Date.now();
    try {
      const res = await env.DRAFT.get(env.DRAFT.idFromName(name)).fetch(request);
      return Response.json({ wallMsSeenByCaller: Date.now() - t0, ...(await res.json()) });
    } catch (e) {
      return Response.json(
        { wallMsSeenByCaller: Date.now() - t0, error: String(e?.message ?? e) },
        { status: 500 },
      );
    }
  },
};
