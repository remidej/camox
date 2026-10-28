import { env } from "cloudflare:workers";
import git from "isomorphic-git";
import http from "isomorphic-git/http/web";

import { MemoryFs } from "../src/lib/memory-fs";

// A member's checkout of a flagged project, held in memory: cloned from the fake Git server as
// `camox clone` would, committed to on a local branch, and bundled as `camox push` sends it, a
// Git bundle (v2) of the branch's commits since the ones it shares with `main`.

const DIR = "/";
const BRANCH = "pricing";
const MAIN = "refs/remotes/origin/main";
const AUTHOR = { name: "Ada", email: "ada@acme.test", timestamp: 1_700_000_100, timezoneOffset: 0 };

type Artifacts = { get(name: string): Promise<{ info(): Promise<{ remote: string }> }> };

/** Clones the project's repo `repo`, on a new local branch from its `main`. */
export async function checkoutOf(repo: string, branch = BRANCH) {
  const fs = new MemoryFs();
  const at = { fs, dir: DIR };
  const { remote } = await (
    await (env as unknown as { ARTIFACTS: Artifacts }).ARTIFACTS.get(repo)
  ).info();
  await git.clone({ ...at, http, url: remote, ref: "main", singleBranch: true });
  await git.branch({ ...at, ref: branch, checkout: true });
  /** The draft's branch the local branch follows, once pulled, as `camox push` sets it. */
  let upstream: string | undefined;

  /** Commits `changes` on the branch: a path's new content, or null to delete it. */
  async function commit(changes: Record<string, string | null>, message = "Change the website") {
    for (const [path, content] of Object.entries(changes)) {
      if (content === null) {
        await fs.promises.unlink(`/${path}`);
        await git.remove({ ...at, filepath: path });
        continue;
      }
      const dirs = path.split("/").slice(0, -1);
      for (let depth = 1; depth <= dirs.length; depth++) {
        await fs.promises
          .mkdir(`/${dirs.slice(0, depth).join("/")}`)
          .catch((error: { code?: string }) => {
            if (error.code !== "EEXIST") throw error;
          });
      }
      await fs.promises.writeFile(`/${path}`, content);
      await git.add({ ...at, filepath: path });
    }
    return git.commit({ ...at, message, author: AUTHOR });
  }

  /** Fetches `main` and merges it into the branch, as `git pull origin main` would. */
  async function mergeMain() {
    await git.fetch({ ...at, http, url: remote, ref: "main", singleBranch: true, tags: false });
    const { oid } = await git.merge({
      ...at,
      ours: branch,
      theirs: MAIN,
      author: AUTHOR,
      message: "Merge main",
    });
    await git.checkout({ ...at, ref: branch, force: true });
    return oid!;
  }

  /**
   * Fetches the repo's branch `name`, a draft's, and merges it into the branch, as `git pull`
   * does once the branch follows it: a fast-forward when the branch has nothing of its own.
   */
  async function pull(name: string) {
    const ref = `refs/remotes/origin/${name}`;
    const { fetchHead } = await git.fetch({
      ...at,
      http,
      url: remote,
      ref: name,
      remoteRef: name,
      singleBranch: true,
      tags: false,
    });
    await git.writeRef({ ...at, ref, value: fetchHead!, force: true });
    await git.merge({ ...at, ours: branch, theirs: ref, author: AUTHOR, message: `Merge ${name}` });
    await git.checkout({ ...at, ref: branch, force: true });
    upstream = ref;
  }

  /**
   * The branch's commits as a Git bundle: every commit of the branch that `main`, as the
   * checkout last fetched it, and the draft's branch it last pulled don't have, or that `since`
   * doesn't, with the commits they build on as its prerequisites.
   */
  async function bundle({ since }: { since?: string } = {}) {
    const head = await git.resolveRef({ ...at, ref: branch });
    const excluded = await ancestors(since ?? (await git.resolveRef({ ...at, ref: MAIN })));
    if (!since && upstream) {
      for (const oid of await ancestors(await git.resolveRef({ ...at, ref: upstream }))) {
        excluded.add(oid);
      }
    }
    const commits: string[] = [];
    const prerequisites = new Set<string>();
    const seen = new Set<string>();
    const walk = [head];
    while (walk.length > 0) {
      const oid = walk.pop()!;
      if (seen.has(oid)) continue;
      seen.add(oid);
      if (excluded.has(oid)) {
        prerequisites.add(oid);
        continue;
      }
      commits.push(oid);
      walk.push(...(await git.readCommit({ ...at, oid })).commit.parent);
    }
    const objects = new Set(commits);
    for (const oid of commits) {
      const { commit: read } = await git.readCommit({ ...at, oid });
      for (const object of await treeObjects(read.tree)) objects.add(object);
    }
    const { packfile } = await git.packObjects({ ...at, oids: [...objects] });
    const header =
      "# v2 git bundle\n" +
      [...prerequisites].map((oid) => `-${oid}\n`).join("") +
      `${head} refs/heads/${branch}\n\n`;
    const bytes = new Uint8Array([...new TextEncoder().encode(header), ...packfile!]);
    return new File([bytes], `${branch}.bundle`);
  }

  async function ancestors(from: string) {
    const found = new Set<string>();
    const walk = [from];
    while (walk.length > 0) {
      const oid = walk.pop()!;
      if (found.has(oid)) continue;
      found.add(oid);
      walk.push(...(await git.readCommit({ ...at, oid })).commit.parent);
    }
    return found;
  }

  async function treeObjects(tree: string): Promise<string[]> {
    const found = [tree];
    for (const entry of (await git.readTree({ ...at, oid: tree })).tree) {
      if (entry.type === "tree") found.push(...(await treeObjects(entry.oid)));
      else found.push(entry.oid);
    }
    return found;
  }

  /** The commits of the repo's branch `name`, newest first, as `git fetch` brings them. */
  async function remoteLog(name: string) {
    const ref = `refs/remotes/origin/${name}`;
    const { fetchHead } = await git.fetch({
      ...at,
      http,
      url: remote,
      ref: name,
      remoteRef: name,
      singleBranch: true,
      tags: false,
    });
    await git.writeRef({ ...at, ref, value: fetchHead!, force: true });
    return (await git.log({ ...at, ref })).map(({ oid }) => oid);
  }

  return {
    branch,
    commit,
    mergeMain,
    pull,
    bundle,
    remoteLog,
    log: async () => (await git.log({ ...at, ref: branch })).map(({ oid }) => oid),
  };
}

export type Checkout = Awaited<ReturnType<typeof checkoutOf>>;
