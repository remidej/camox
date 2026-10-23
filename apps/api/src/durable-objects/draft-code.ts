import { DurableObject } from "cloudflare:workers";
import git from "isomorphic-git";
import http from "isomorphic-git/http/web";

import { codeEnv } from "../domains/code/env";
import { CODE_ROOT, mountSkills, SKILLS_ROOT, writeFiles } from "../domains/code/main-copy";
import { answerEnvCall, type EnvAnswer, type EnvCall } from "../domains/code/remote-env";
import { writeLine } from "../domains/code/write-line";
import { MemoryFs, type MemoryFsEntry } from "../lib/memory-fs";
import { tar, type TarEntry } from "../lib/tar";
import type { Bindings } from "../types";

const MAIN = "main";
/** The repo the branch is in: its project's, named by the Project ID. */
const REPO_KEY = "repo";
/** The branch, named after the draft's ID: a draft with code is one whose branch exists. */
const BRANCH_KEY = "branch";
/** The commit of `main` the branch forked from. */
const FORKED_FROM_KEY = "forked-from";
const TOKEN_KEY = "token";

/** How long the write tokens the working copy mints last, in seconds. */
export const TOKEN_TTL_SECONDS = 86_400;
/** How close to its expiry a write token is replaced rather than used again. */
export const TOKEN_RENEWAL_MS = 60 * 60 * 1000;

/** The most bytes of a file one row holds, well under SQLite's limit for a value. */
const CHUNK_BYTES = 1 << 20;

type StoredToken = { id: string; plaintext: string; expiresAt: string };

/** The author of the commits the working copy makes. */
const COMMIT_AUTHOR = { name: "Camox", email: "agent@camox.ai" };

/** The lockfile, whose changes a build installs. */
const LOCKFILE = "pnpm-lock.yaml";

/** A commit `prepareCommit` made, not on the branch yet. */
export type PreparedCommit = {
  commit: string;
  tree: string;
  /** The tree's files, as a tar archive. */
  files: Uint8Array;
  /** The tree's `pnpm-lock.yaml`, if it has one. */
  lockfile: string | null;
};

type NodeRow = {
  path: string;
  part: number;
  kind: MemoryFsEntry["kind"];
  mode: number | null;
  target: string | null;
  data: ArrayBuffer | null;
};

/**
 * The working copy of one draft with code, addressed by the draft's ID (`getByName`): a depth-1
 * clone of the draft's branch, held in memory, which the agent's code tools read and write over
 * RPC, through the write line. Every change is saved to its SQLite as it's made, Git's own
 * directory included, so an eviction restores it without cloning again. The SDK's code
 * references are mounted beside the files and never saved, nor committed.
 *
 * It stores nothing until `start` made it, and nothing once `discard` deleted it.
 */
export class DraftCode extends DurableObject<Bindings> {
  /** The working copy, once loaded from storage or cloned. */
  #fs: MemoryFs | undefined;
  /** The last operation, which the next waits for: one at a time. */
  #queue: Promise<unknown> = Promise.resolve();

  #serially<T>(operation: () => Promise<T>): Promise<T> {
    const done = this.#queue.then(operation);
    this.#queue = done.catch(() => undefined);
    return done;
  }

  /** The draft's ID, which names the branch. */
  #draftId() {
    const name = this.ctx.id.name;
    if (!name) throw new Error("A draft's working copy doesn't know its draft");
    return name;
  }

  /** Whether the draft has code: its branch was made, and not deleted since. */
  async held(): Promise<boolean> {
    await this.#queue;
    return this.ctx.storage.kv.get(BRANCH_KEY) !== undefined;
  }

  /**
   * Makes the draft's branch and working copy, from `commit` of `main` in the project's repo
   * `repo`, unless they were made already. Returns the commit the branch forked from.
   */
  start({ repo, commit }: { repo: string; commit: string }): Promise<string> {
    return this.#serially(async () => {
      const forked = this.ctx.storage.kv.get<string>(FORKED_FROM_KEY);
      if (forked && this.ctx.storage.kv.get(BRANCH_KEY)) return forked;
      const branch = this.#draftId();
      using artifacts = await this.env.ARTIFACTS.get(repo);
      const { remote } = await artifacts.info();
      const headers = { Authorization: `Bearer ${await this.#token(artifacts)}` };
      const fs = new MemoryFs();
      const at = { fs, http, dir: CODE_ROOT, url: remote, headers };
      await git.clone({ ...at, ref: MAIN, singleBranch: true, depth: 1, noCheckout: true });
      // `main` moved since the copy the agent read: the branch starts where that copy is.
      const tip = await git.resolveRef({ fs, dir: CODE_ROOT, ref: "HEAD" });
      if (tip !== commit) {
        await git.fetch({ ...at, remoteRef: commit, singleBranch: true, depth: 1, tags: false });
      }
      await git.branch({ fs, dir: CODE_ROOT, ref: branch, object: commit, checkout: true });
      await git.checkout({ fs, dir: CODE_ROOT, ref: branch, force: true });
      await git.push({ ...at, ref: branch, remoteRef: branch });
      // The references mounted beside the files are never committed.
      await writeFiles(fs, [
        {
          path: ".git/info/exclude",
          content: new TextEncoder().encode(`${SKILLS_ROOT.slice(1)}/\n`),
        },
      ]);
      fs.takeChanges();
      this.ctx.storage.transactionSync(() => {
        this.#createTables();
        for (const entry of fs.entries()) this.#insert(entry);
        this.ctx.storage.kv.put(REPO_KEY, repo);
        this.ctx.storage.kv.put(FORKED_FROM_KEY, commit);
        this.ctx.storage.kv.put(BRANCH_KEY, branch);
      });
      await mountSkills(fs);
      fs.takeChanges();
      this.#fs = fs;
      return commit;
    });
  }

  /** Runs one operation of the agent's environment on the working copy, and saves what it changed. */
  call(call: EnvCall): Promise<EnvAnswer> {
    return this.#serially(async () => {
      const fs = await this.#workingCopy();
      const answer = await answerEnvCall(
        codeEnv(fs, { cwd: CODE_ROOT, writable: writeLine }),
        call,
      );
      this.#save(fs);
      return answer;
    });
  }

  /**
   * Stages the working copy's every change and makes, without moving the branch, the commit it
   * would be: `message` on top of the branch's head. Returns the commit and its tree, with the
   * tree's files as a tar archive, which a build streams into its sandbox, and the lockfile.
   * Neither Git's directory nor the references mounted beside the files are in the tree.
   */
  prepareCommit({ message }: { message: string }): Promise<PreparedCommit> {
    return this.#serially(async () => {
      const fs = await this.#workingCopy();
      const at = { fs, dir: CODE_ROOT };
      const entries: TarEntry[] = [];
      for (const [filepath, head, workdir, stage] of await git.statusMatrix(at)) {
        if (workdir === 0) {
          if (stage !== 0) await git.remove({ ...at, filepath });
          continue;
        }
        if (!(head === 1 && workdir === 1 && stage === 1) && !(workdir === 2 && stage === 2)) {
          await git.add({ ...at, filepath });
        }
        const entry = fs.entry(`/${filepath}`);
        if (entry?.kind === "file") {
          entries.push({ path: filepath, mode: entry.mode & 0o777, content: entry.data });
        } else if (entry?.kind === "symlink") {
          entries.push({ path: filepath, symlink: entry.target });
        }
      }
      const commit = await git.commit({
        ...at,
        message,
        author: COMMIT_AUTHOR,
        noUpdateBranch: true,
      });
      this.#save(fs);
      const { commit: read } = await git.readCommit({ ...at, oid: commit });
      const lockfile = entries.find(({ path }) => path === LOCKFILE);
      return {
        commit,
        tree: read.tree,
        files: tar(entries),
        lockfile:
          lockfile && "content" in lockfile ? new TextDecoder().decode(lockfile.content) : null,
      };
    });
  }

  /**
   * Moves the draft's branch to `commit`, which `prepareCommit` made, and pushes it. A commit of
   * the tree the branch's head already has, such as one prepared again after the push of the
   * first, leaves the head as it is. Returns the branch's head and its parents.
   */
  commit({ commit }: { commit: string }): Promise<{ commit: string; parents: string[] }> {
    return this.#serially(async () => {
      const fs = await this.#workingCopy();
      const at = { fs, dir: CODE_ROOT };
      const branch = this.ctx.storage.kv.get<string>(BRANCH_KEY)!;
      const ref = `refs/heads/${branch}`;
      const head = await git.resolveRef({ ...at, ref });
      const { commit: made } = await git.readCommit({ ...at, oid: commit });
      let landed = commit;
      if (head !== commit) {
        const { commit: current } = await git.readCommit({ ...at, oid: head });
        if (current.tree === made.tree) landed = head;
        else if (made.parent.includes(head)) {
          await git.writeRef({ ...at, ref, value: commit, force: true });
        } else {
          throw new Error("The draft's branch moved since this commit was prepared");
        }
      }
      using artifacts = await this.env.ARTIFACTS.get(this.ctx.storage.kv.get<string>(REPO_KEY)!);
      const { remote } = await artifacts.info();
      const headers = { Authorization: `Bearer ${await this.#token(artifacts)}` };
      await git.push({ ...at, http, url: remote, headers, ref: branch, remoteRef: branch });
      this.#save(fs);
      const { commit: pushed } = await git.readCommit({ ...at, oid: landed });
      return { commit: landed, parents: pushed.parent };
    });
  }

  /** Deletes the draft's branch and everything the working copy stored, as the draft ends. */
  discard(): Promise<void> {
    return this.#serially(async () => {
      const repo = this.ctx.storage.kv.get<string>(REPO_KEY);
      const branch = this.ctx.storage.kv.get<string>(BRANCH_KEY);
      try {
        if (repo && branch) await this.#deleteBranch(repo, branch);
      } finally {
        this.#fs = undefined;
        await this.ctx.storage.deleteAll();
      }
    });
  }

  async #deleteBranch(repo: string, branch: string) {
    using artifacts = await this.env.ARTIFACTS.get(repo);
    const { remote } = await artifacts.info();
    const headers = { Authorization: `Bearer ${await this.#token(artifacts)}` };
    await git.push({
      fs: await this.#workingCopy(),
      http,
      dir: CODE_ROOT,
      url: remote,
      headers,
      ref: branch,
      remoteRef: branch,
      delete: true,
    });
    const token = this.ctx.storage.kv.get<StoredToken>(TOKEN_KEY);
    if (token) await artifacts.revokeToken(token.id).catch(() => false);
  }

  /** The write token for the repo, kept until it's close to its expiry. */
  async #token(artifacts: ArtifactsRepo) {
    const held = this.ctx.storage.kv.get<StoredToken>(TOKEN_KEY);
    if (held && Date.parse(held.expiresAt) - Date.now() > TOKEN_RENEWAL_MS) return held.plaintext;
    const { id, plaintext, expiresAt } = await artifacts.createToken("write", TOKEN_TTL_SECONDS);
    this.ctx.storage.kv.put(TOKEN_KEY, { id, plaintext, expiresAt } satisfies StoredToken);
    if (held) await artifacts.revokeToken(held.id).catch(() => false);
    return plaintext;
  }

  /** The working copy, restored from storage after an eviction. */
  async #workingCopy() {
    if (this.#fs) return this.#fs;
    if (this.ctx.storage.kv.get(BRANCH_KEY) === undefined) {
      throw new Error("This draft has no working copy: its first code write makes it");
    }
    const entries = new Map<string, MemoryFsEntry>();
    const rows = this.ctx.storage.sql
      .exec<NodeRow>("SELECT path, part, kind, mode, target, data FROM nodes ORDER BY path, part")
      .toArray();
    const parts = new Map<string, Uint8Array[]>();
    for (const row of rows) {
      if (row.kind === "file") {
        parts.set(row.path, [
          ...(parts.get(row.path) ?? []),
          new Uint8Array(row.data ?? new ArrayBuffer(0)),
        ]);
        if (row.part > 0) continue;
        entries.set(row.path, {
          path: row.path,
          kind: "file",
          mode: row.mode!,
          data: new Uint8Array(),
        });
      } else if (row.kind === "symlink") {
        entries.set(row.path, { path: row.path, kind: "symlink", target: row.target! });
      } else entries.set(row.path, { path: row.path, kind: "dir" });
    }
    for (const [path, chunks] of parts) {
      const entry = entries.get(path);
      if (entry?.kind === "file") entry.data = joined(chunks);
    }
    const fs = MemoryFs.from(entries.values());
    await mountSkills(fs);
    fs.takeChanges();
    this.#fs = fs;
    return fs;
  }

  #createTables() {
    this.ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS nodes (
        path TEXT NOT NULL, part INTEGER NOT NULL, kind TEXT NOT NULL, mode INTEGER,
        target TEXT, data BLOB, PRIMARY KEY (path, part))`,
    );
  }

  /** Stores what the paths changed since the last save hold now. */
  #save(fs: MemoryFs) {
    const changed = fs
      .takeChanges()
      .filter((path) => path !== SKILLS_ROOT && !path.startsWith(`${SKILLS_ROOT}/`));
    if (changed.length === 0) return;
    this.ctx.storage.transactionSync(() => {
      for (const path of changed) {
        this.ctx.storage.sql.exec("DELETE FROM nodes WHERE path = ?", path);
        const entry = fs.entry(path);
        if (entry) this.#insert(entry);
      }
    });
  }

  #insert(entry: MemoryFsEntry) {
    const insert = (
      part: number,
      values: Pick<NodeRow, "mode" | "target"> & { data: Uint8Array | null },
    ) =>
      this.ctx.storage.sql.exec(
        "INSERT INTO nodes (path, part, kind, mode, target, data) VALUES (?, ?, ?, ?, ?, ?)",
        entry.path,
        part,
        entry.kind,
        values.mode,
        values.target,
        values.data,
      );
    if (entry.kind === "dir") insert(0, { mode: null, target: null, data: null });
    else if (entry.kind === "symlink") insert(0, { mode: null, target: entry.target, data: null });
    else {
      let part = 0;
      for (let at = 0; at === 0 || at < entry.data.byteLength; at += CHUNK_BYTES) {
        insert(part++, {
          mode: part === 1 ? entry.mode : null,
          target: null,
          data: entry.data.subarray(at, at + CHUNK_BYTES),
        });
      }
    }
  }
}

function joined(chunks: Uint8Array[]) {
  const data = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
  let at = 0;
  for (const chunk of chunks) {
    data.set(chunk, at);
    at += chunk.byteLength;
  }
  return data;
}
