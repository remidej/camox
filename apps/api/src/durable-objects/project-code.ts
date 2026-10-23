import { DurableObject } from "cloudflare:workers";
import git from "isomorphic-git";
import http from "isomorphic-git/http/web";

import type { CodeFile } from "../domains/code/main-copy";
import { MemoryFs } from "../lib/memory-fs";
import type { Bindings } from "../types";

const MAIN = "main";
const COMMIT_KEY = "commit";

/** What `snapshot` answers: the files only when the caller doesn't already have that commit. */
export type MainSnapshot = { commit: string; files?: CodeFile[] };

/**
 * A read-only copy of one project's `main`, addressed by its Project ID, which names its repo.
 * The agent reads the website's code from it on Live, and in a draft without code. A push to
 * `main` refreshes it (the release Workflow), and a copy that was never made is made on its first
 * read. It keeps the files in its SQLite, so an eviction doesn't clone again; Git's own directory
 * isn't kept.
 */
export class ProjectCode extends DurableObject<Bindings> {
  /** Refreshing the copy, which the next refresh waits for. */
  #refreshing: Promise<unknown> = Promise.resolve();

  constructor(ctx: DurableObjectState, env: Bindings) {
    super(ctx, env);
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS files (path TEXT PRIMARY KEY, symlink TEXT, content BLOB)",
    );
  }

  /** The Project ID: the object is addressed by it (`getByName`). */
  #repoName() {
    const name = this.ctx.id.name;
    if (!name) throw new Error("A project's code copy doesn't know its project");
    return name;
  }

  #commit() {
    return this.ctx.storage.kv.get<string>(COMMIT_KEY);
  }

  /**
   * Makes the copy match `main`, unless it already holds `commit`, the commit a push moved `main`
   * to. Returns the commit it holds. One refresh at a time.
   */
  refresh(commit?: string): Promise<string> {
    const refreshed = this.#refreshing.then(async () => {
      const held = this.#commit();
      if (held && held === commit) return held;
      return this.#clone();
    });
    this.#refreshing = refreshed.catch(() => undefined);
    return refreshed;
  }

  /** The copy, made first if it never was; only its commit when it's `known`. */
  async snapshot(known?: string): Promise<MainSnapshot> {
    await this.#refreshing;
    const commit = this.#commit() ?? (await this.refresh());
    if (commit === known) return { commit };
    const files = this.ctx.storage.sql
      .exec<{ path: string; symlink: string | null; content: ArrayBuffer | null }>(
        "SELECT path, symlink, content FROM files ORDER BY path",
      )
      .toArray()
      .map(({ path, symlink, content }): CodeFile =>
        symlink === null ? { path, content: new Uint8Array(content!) } : { path, symlink },
      );
    return { commit, files };
  }

  /** Clones `main` at depth 1 and keeps its files in place of the ones held. */
  async #clone() {
    using repo = await this.env.ARTIFACTS.get(this.#repoName());
    const { remote } = await repo.info();
    const token = await repo.createToken("read", 600);
    try {
      const fs = new MemoryFs();
      await git.clone({
        fs,
        http,
        dir: "/",
        url: remote,
        ref: MAIN,
        singleBranch: true,
        depth: 1,
        headers: { Authorization: `Bearer ${token.plaintext}` },
      });
      const commit = await git.resolveRef({ fs, dir: "/", ref: "HEAD" });
      const files = await filesOf(fs);
      this.ctx.storage.transactionSync(() => {
        this.ctx.storage.sql.exec("DELETE FROM files");
        for (const file of files) {
          this.ctx.storage.sql.exec(
            "INSERT INTO files (path, symlink, content) VALUES (?, ?, ?)",
            file.path,
            "symlink" in file ? file.symlink : null,
            "content" in file ? file.content : null,
          );
        }
        this.ctx.storage.kv.put(COMMIT_KEY, commit);
      });
      return commit;
    } finally {
      await repo.revokeToken(token.id).catch(() => false);
    }
  }
}

/** Every file and symlink of a checkout, but Git's own directory's. */
async function filesOf(fs: MemoryFs, dir = ""): Promise<CodeFile[]> {
  const files: CodeFile[] = [];
  for (const name of await fs.promises.readdir(dir || "/")) {
    if (!dir && name === ".git") continue;
    const path = dir ? `${dir}/${name}` : name;
    const stat = await fs.promises.lstat(`/${path}`);
    if (stat.isDirectory()) files.push(...(await filesOf(fs, path)));
    else if (stat.isSymbolicLink()) {
      files.push({ path, symlink: await fs.promises.readlink(`/${path}`) });
    } else {
      files.push({ path, content: (await fs.promises.readFile(`/${path}`)) as Uint8Array });
    }
  }
  return files;
}
