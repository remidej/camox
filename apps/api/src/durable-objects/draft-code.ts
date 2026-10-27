import { DurableObject } from "cloudflare:workers";
import git from "isomorphic-git";
import http from "isomorphic-git/http/web";

import { hasConflictMarkers } from "../domains/code/conflict-markers";
import { codeEnv } from "../domains/code/env";
import { CODE_ROOT, mountSkills, SKILLS_ROOT, writeFiles } from "../domains/code/main-copy";
import { answerEnvCall, type EnvAnswer, type EnvCall } from "../domains/code/remote-env";
import { writeLine } from "../domains/code/write-line";
import type { BuildResult } from "../domains/revisions/result";
import { MemoryFs, type MemoryFsEntry } from "../lib/memory-fs";
import { serialQueue } from "../lib/serial-queue";
import { tar, type TarEntry } from "../lib/tar";
import type { Bindings } from "../types";

const MAIN = "main";
/** The local ref a publish's squashed commit is pushed to `main` from. */
const PUBLISH_REF = "refs/heads/camox-publish";
/** The repo the branch is in: its project's, named by the Project ID. */
const REPO_KEY = "repo";
/** The branch, named after the draft's ID: a draft with code is one whose branch exists. */
const BRANCH_KEY = "branch";
/** The commit of `main` the branch forked from. */
const FORKED_FROM_KEY = "forked-from";
/** The commit of `main` the branch last merged, once it merged one. */
const MERGED_KEY = "merged-main";
/** A merge of `main` that clashed, left for Camox's reconcile turn (`MergeClash`). */
const CLASH_KEY = "merge-clash";
/**
 * The commit of `main` whose merge the files hold, uncommitted, for Camox's reconcile turn: the
 * revision a build commits then is the merge commit.
 */
const MERGING_KEY = "merging-main";
/**
 * What the files held, uncommitted, as the merge of `MERGING_KEY` was written into them: files
 * that changed since hold writes of the agent's too (`uncommittedDigest`).
 */
const MERGING_FILES_KEY = "merging-files";
/** The local refs a merge left in the files names its sides by, in its conflict markers. */
const OURS_REF = "refs/remotes/draft";
const THEIRS_REF = "refs/remotes/Live";
/** The local refs a merge of `main` fetches from, and merges: see `mergeMain`. */
const MERGED_REF = "refs/camox/merged-main";
const MAIN_REF = "refs/camox/main";
const TOKEN_KEY = "token";
/** When the build of the draft's code going now started, if one is. */
const BUILDING_SINCE_KEY = "building-since";
/**
 * A build of the draft's code that Camox's infrastructure kept failing, which its retry owes
 * (`OwedBuild`): the draft shows it's building until one lands.
 */
const OWED_BUILD_KEY = "owed-build";

/** How long Camox waits before its first retry of a build it owes, doubling after each. */
export const OWED_BUILD_RETRY_MS = 30_000;
/** The longest Camox waits between two retries of a build it owes. A tuning value. */
export const OWED_BUILD_RETRY_AT_MOST_MS = 15 * 60_000;

/** A build Camox owes the draft: the thread that builds it, and how many retries it had. */
type OwedBuild = { threadId: string; retries: number };

/**
 * How long a build is taken to still be going, from when it started: one an eviction cut short
 * never says it ended. Longer than any build takes. A tuning value.
 */
export const BUILD_GOING_FOR_AT_MOST_MS = 15 * 60_000;

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

/**
 * A merge of `main` that doesn't land as a revision as it is: it conflicts, or its tree doesn't
 * build or type check. Recorded for Camox's reconcile turn, which tries once for each move of
 * `main`, until code holding that `main` builds without errors (`settleClash`): the draft has
 * the "doesn't merge with Live's" blocker until then.
 */
export type MergeClash = {
  /** The commit of `main` that clashed. */
  main: string;
  /** The files both sides changed in ways that don't merge, for a merge that conflicts. */
  conflicts?: string[];
  /** The merged tree's build, for a merge that doesn't build or type check. */
  result?: BuildResult;
};

/** What merging `main` into the working copy found. */
export type MergeOutcome =
  /** The draft holds the current `main` already. */
  | { outcome: "upToDate" }
  /** The working copy has changes no revision holds yet: the merge waits for them. */
  | { outcome: "unsettled" }
  /** This move of `main` clashed already, and isn't merged again until `main` moves again. */
  | { outcome: "clashedBefore"; main: string }
  | { outcome: "conflicts"; main: string; conflicts: string[] }
  /** A merge commit of `main`, not on the branch yet, for a build to commit. */
  | { outcome: "merged"; main: string; prepared: PreparedCommit };

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
 * It stores nothing until `start` made it, and nothing once `delete` deleted it.
 */
export class DraftCode extends DurableObject<Bindings> {
  /** The working copy, once loaded from storage or cloned. */
  #fs: MemoryFs | undefined;
  /** The working copy's operations, one at a time. */
  readonly #queue = serialQueue();

  #serially<T>(operation: () => Promise<T>): Promise<T> {
    return this.#queue.run(operation);
  }

  /** The draft's ID, which names the branch. */
  #draftId() {
    const name = this.ctx.id.name;
    if (!name) throw new Error("A draft's working copy doesn't know its draft");
    return name;
  }

  /** Whether the draft has code: its branch was made, and not deleted since. */
  async held(): Promise<boolean> {
    await this.#queue.idle();
    return this.ctx.storage.kv.get(BRANCH_KEY) !== undefined;
  }

  /**
   * The commit of `main` the draft's code holds: the one its branch last merged, or forked from,
   * once it has code.
   */
  async mergedMain(): Promise<string | undefined> {
    await this.#queue.idle();
    return this.#mergedMain();
  }

  #mergedMain() {
    return (
      this.ctx.storage.kv.get<string>(MERGED_KEY) ??
      this.ctx.storage.kv.get<string>(FORKED_FROM_KEY)
    );
  }

  /**
   * Where the draft's merges of `main` stand: the branch's head, the `main` it holds, and the
   * last merge that clashed, read at once, as a commit moves them together.
   */
  async merges(): Promise<{ head: string; mergedMain: string; clash: MergeClash | undefined }> {
    return this.#serially(async () => {
      const fs = await this.#workingCopy();
      const branch = this.ctx.storage.kv.get<string>(BRANCH_KEY)!;
      return {
        head: await git.resolveRef({ fs, dir: CODE_ROOT, ref: `refs/heads/${branch}` }),
        mergedMain: this.#mergedMain()!,
        clash: this.ctx.storage.kv.get<MergeClash>(CLASH_KEY),
      };
    });
  }

  /** The last merge of `main` that clashed, until a merge of `main` lands. */
  async clash(): Promise<MergeClash | undefined> {
    await this.#queue.idle();
    return this.ctx.storage.kv.get<MergeClash>(CLASH_KEY);
  }

  /**
   * Records that the merge of `main` at `clash.main` clashed (see `MergeClash`), for Camox's
   * reconcile turn. A merge that didn't land is left in the files, uncommitted, conflict markers
   * included, and the next revision is its merge commit: see `merging`.
   */
  recordClash(clash: MergeClash): Promise<void> {
    return this.#serially(async () => {
      if (this.ctx.storage.kv.get(BRANCH_KEY) === undefined) return;
      this.ctx.storage.kv.put(CLASH_KEY, clash);
      if (this.#mergedMain() === clash.main) return;
      const fs = await this.#workingCopy();
      await mergeIntoFiles(fs, {
        ours: `refs/heads/${this.ctx.storage.kv.get<string>(BRANCH_KEY)!}`,
        base: this.#mergedMain()!,
        theirs: clash.main,
      });
      this.ctx.storage.kv.put(MERGING_KEY, clash.main);
      this.ctx.storage.kv.put(MERGING_FILES_KEY, await uncommittedDigest(fs));
      this.#save(fs);
    });
  }

  /**
   * The commit of `main` whose merge the files hold, uncommitted, if they do: Camox's reconcile
   * turn fixes it, and its build commits the merge commit.
   */
  async merging(): Promise<string | undefined> {
    await this.#queue.idle();
    return this.ctx.storage.kv.get<string>(MERGING_KEY);
  }

  /**
   * Forgets the clash, once the draft's code built without errors and holds the `main` that
   * clashed: unless the files still hold a merge no commit landed.
   */
  settleClash(): Promise<void> {
    return this.#serially(async () => {
      const clash = this.ctx.storage.kv.get<MergeClash>(CLASH_KEY);
      if (!clash || this.ctx.storage.kv.get(MERGING_KEY) !== undefined) return;
      const merged = this.#mergedMain()!;
      const holds =
        merged === clash.main ||
        (await git
          .isDescendent({
            fs: await this.#workingCopy(),
            dir: CODE_ROOT,
            oid: merged,
            ancestor: clash.main,
            depth: -1,
          })
          .catch(() => false));
      if (holds) this.ctx.storage.kv.delete(CLASH_KEY);
    });
  }

  /** Records that a build of the draft's code started, or ended. */
  async markBuilding(building: boolean): Promise<void> {
    if (building) this.ctx.storage.kv.put(BUILDING_SINCE_KEY, Date.now());
    else this.ctx.storage.kv.delete(BUILDING_SINCE_KEY);
  }

  /**
   * Whether a build of the draft's code is going (see `BUILD_GOING_FOR_AT_MOST_MS`), or owed:
   * Camox's infrastructure failed the last one, and Camox retries it.
   */
  async building(): Promise<boolean> {
    if (this.ctx.storage.kv.get(OWED_BUILD_KEY) !== undefined) return true;
    const since = this.ctx.storage.kv.get<number>(BUILDING_SINCE_KEY);
    return since !== undefined && Date.now() - since < BUILD_GOING_FOR_AT_MOST_MS;
  }

  /**
   * Records that the thread `threadId` couldn't build the draft's code because of Camox's own
   * infrastructure, and has it retry later (`alarm`), each retry waiting longer.
   */
  async oweBuild({ threadId }: { threadId: string }): Promise<void> {
    if (this.ctx.storage.kv.get(BRANCH_KEY) === undefined) return;
    const owed = this.ctx.storage.kv.get<OwedBuild>(OWED_BUILD_KEY);
    const retries = owed?.retries ?? 0;
    this.ctx.storage.kv.put(OWED_BUILD_KEY, { threadId, retries } satisfies OwedBuild);
    const wait = Math.min(OWED_BUILD_RETRY_MS * 2 ** retries, OWED_BUILD_RETRY_AT_MOST_MS);
    await this.ctx.storage.setAlarm(Date.now() + wait);
  }

  /** Forgets the build Camox owed the draft, once one ended without Camox's failing. */
  async settleOwedBuild(): Promise<void> {
    if (this.ctx.storage.kv.get(OWED_BUILD_KEY) === undefined) return;
    this.ctx.storage.kv.delete(OWED_BUILD_KEY);
    await this.ctx.storage.deleteAlarm();
  }

  /** Retries the build Camox owes the draft, in its thread's build queue, until one lands. */
  async alarm(): Promise<void> {
    const owed = this.ctx.storage.kv.get<OwedBuild>(OWED_BUILD_KEY);
    if (!owed) return;
    this.ctx.storage.kv.put(OWED_BUILD_KEY, { ...owed, retries: owed.retries + 1 });
    try {
      // A build that fails on Camox's side again owes the next retry itself.
      if ((await this.env.THREAD.getByName(owed.threadId).retryBuild()) !== "busy") return;
    } catch (error) {
      console.error("Camox's retry of a draft's build failed", error);
    }
    await this.oweBuild({ threadId: owed.threadId });
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
   * The files that have merge conflict markers, as a merge of `main` that conflicts leaves them:
   * only files the branch's head doesn't hold as they are, since no commit holds markers.
   */
  conflicts(): Promise<string[]> {
    return this.#serially(async () => {
      const fs = await this.#workingCopy();
      const found: string[] = [];
      for (const [filepath, , workdir] of await git.statusMatrix({ fs, dir: CODE_ROOT })) {
        if (workdir !== 2) continue;
        const entry = fs.entry(`/${filepath}`);
        if (entry?.kind !== "file") continue;
        if (hasConflictMarkers(new TextDecoder().decode(entry.data))) found.push(filepath);
      }
      return found;
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
      // Files holding a merge of `main` make its merge commit, whatever the build that commits it.
      const merging = this.ctx.storage.kv.get<string>(MERGING_KEY);
      const branch = this.ctx.storage.kv.get<string>(BRANCH_KEY)!;
      const commit = await git.commit({
        ...at,
        message: merging ? MERGE_MESSAGE : message,
        author: COMMIT_AUTHOR,
        noUpdateBranch: true,
        ...(merging && {
          parent: [await git.resolveRef({ ...at, ref: `refs/heads/${branch}` }), merging],
        }),
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
      // A merge of `main` lands even when it changes no file: the branch then holds that `main`.
      const merge = made.parent.length > 1;
      if (head !== commit) {
        const { commit: current } = await git.readCommit({ ...at, oid: head });
        if (current.tree === made.tree && !(merge && made.parent[0] === head)) landed = head;
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
      if (merge && landed === commit) {
        // A merge made beside the files, which nothing wrote to since, or from them, as Camox's
        // reconcile turn fixed it: the files take its tree either way.
        await git.checkout({ ...at, ref: branch, force: true });
        this.ctx.storage.kv.put(MERGED_KEY, made.parent[1]!);
        this.ctx.storage.kv.delete(MERGING_KEY);
        this.ctx.storage.kv.delete(MERGING_FILES_KEY);
      }
      this.#save(fs);
      const { commit: pushed } = await git.readCommit({ ...at, oid: landed });
      return { commit: landed, parents: pushed.parent };
    });
  }

  /**
   * Pushes the draft's code to `main` as one squashed commit, as a publish lands: the tree of
   * `commit`, a revision on the branch, with the current tip of `main` as its only parent. A
   * `main` that already has that tree, as after a retried push that landed, is left as it is.
   * Returns the commit `main` points to.
   */
  publishToMain({ commit, message }: { commit: string; message: string }): Promise<string> {
    return this.#serially(async () => {
      const fs = await this.#workingCopy();
      const at = { fs, dir: CODE_ROOT };
      using artifacts = await this.env.ARTIFACTS.get(this.ctx.storage.kv.get<string>(REPO_KEY)!);
      const { remote } = await artifacts.info();
      const headers = { Authorization: `Bearer ${await this.#token(artifacts)}` };
      const fetchHead = await this.#mainTip(fs, remote, headers);
      const { commit: published } = await git.readCommit({ ...at, oid: commit });
      const { commit: tip } = await git.readCommit({ ...at, oid: fetchHead });
      if (tip.tree === published.tree) {
        this.#save(fs);
        return fetchHead;
      }
      const signature = {
        ...COMMIT_AUTHOR,
        timestamp: Math.floor(Date.now() / 1000),
        timezoneOffset: 0,
      };
      const squashed = await git.writeCommit({
        ...at,
        commit: {
          message: `${message}\n`,
          tree: published.tree,
          parent: [fetchHead],
          author: signature,
          committer: signature,
        },
      });
      await git.writeRef({ ...at, ref: PUBLISH_REF, value: squashed, force: true });
      await git.push({ ...at, http, url: remote, headers, ref: PUBLISH_REF, remoteRef: MAIN });
      this.#save(fs);
      return squashed;
    });
  }

  /**
   * The commit `main` points to in the project's repo, fetched into the working copy when it
   * doesn't hold it yet, as when another publish moved `main` since the draft forked.
   */
  async #mainTip(fs: MemoryFs, url: string, headers: Record<string, string>) {
    const at = { fs, dir: CODE_ROOT };
    const { refs } = await git.getRemoteInfo2({ http, url, headers });
    const tip = refs?.find(({ ref }) => ref === `refs/heads/${MAIN}`)?.oid;
    if (!tip) throw new Error("The project's repo has no main branch");
    const held = await git.readCommit({ ...at, oid: tip }).then(
      () => true,
      () => false,
    );
    if (!held) {
      await git.fetch({
        ...at,
        http,
        url,
        headers,
        ref: MAIN,
        remoteRef: MAIN,
        singleBranch: true,
        depth: 1,
        tags: false,
      });
    }
    return tip;
  }

  /**
   * Merges the current `main` into the branch, without moving it: fetches `main` shallowly, its
   * history down to the `main` commit the branch last merged or forked from, which is then the
   * merge base, and merges it into the branch's head. A clean merge is returned as a merge commit
   * whose parents are the head and `main`, for a build to commit (`commit`): the files stay as
   * they are until then. A merge that conflicts changes nothing either.
   *
   * It waits while the files have changes no commit holds, and doesn't merge again a move of
   * `main` that clashed. Files holding the merge of an earlier `main` that Camox's reconcile
   * turn didn't fix (`merging`) are put back to the branch's head first, to merge this one.
   */
  mergeMain(): Promise<MergeOutcome> {
    return this.#serially(async () => {
      const fs = await this.#workingCopy();
      const at = { fs, dir: CODE_ROOT };
      using artifacts = await this.env.ARTIFACTS.get(this.ctx.storage.kv.get<string>(REPO_KEY)!);
      const { remote } = await artifacts.info();
      const headers = { Authorization: `Bearer ${await this.#token(artifacts)}` };
      const { refs } = await git.getRemoteInfo2({ http, url: remote, headers });
      const main = refs?.find(({ ref }) => ref === `refs/heads/${MAIN}`)?.oid;
      const merged = this.#mergedMain();
      if (!main || !merged || main === merged) return { outcome: "upToDate" };
      if (this.ctx.storage.kv.get<MergeClash>(CLASH_KEY)?.main === main) {
        return { outcome: "clashedBefore", main };
      }
      const branch = this.ctx.storage.kv.get<string>(BRANCH_KEY)!;
      if (this.ctx.storage.kv.get(MERGING_KEY) !== undefined) {
        // Writes since the merge of an earlier `main` stay: they wait to be committed with it.
        if ((await uncommittedDigest(fs)) !== this.ctx.storage.kv.get(MERGING_FILES_KEY)) {
          return { outcome: "unsettled" };
        }
        // The files hold the merge of an earlier `main` as it was written, which Camox's turn
        // didn't fix: this one is merged afresh, from the branch's head.
        await git.checkout({ ...at, ref: branch, force: true });
        this.ctx.storage.kv.delete(MERGING_KEY);
        this.ctx.storage.kv.delete(MERGING_FILES_KEY);
        this.#save(fs);
      }
      if (!(await settled(fs))) return { outcome: "unsettled" };
      // Only the commits since the one merged last: the fetch says the working copy has that one.
      await git.writeRef({ ...at, ref: MERGED_REF, value: merged, force: true });
      if (!(await holds(fs, main))) {
        await git.fetch({
          ...at,
          http,
          url: remote,
          headers,
          ref: MERGED_REF,
          remoteRef: MAIN,
          singleBranch: true,
          tags: false,
        });
      }
      await git.writeRef({ ...at, ref: MAIN_REF, value: main, force: true });
      const signature = {
        ...COMMIT_AUTHOR,
        timestamp: Math.floor(Date.now() / 1000),
        timezoneOffset: 0,
      };
      try {
        const { oid, tree } = await git.merge({
          ...at,
          ours: `refs/heads/${branch}`,
          theirs: MAIN_REF,
          fastForward: false,
          noUpdateBranch: true,
          abortOnConflict: true,
          message: MERGE_MESSAGE,
          author: signature,
          committer: signature,
        });
        const entries = await treeEntries(fs, oid!);
        this.#save(fs);
        const lockfile = entries.find(({ path }) => path === LOCKFILE);
        return {
          outcome: "merged",
          main,
          prepared: {
            commit: oid!,
            tree: tree!,
            files: tar(entries),
            lockfile:
              lockfile && "content" in lockfile ? new TextDecoder().decode(lockfile.content) : null,
          },
        };
      } catch (error) {
        this.#save(fs);
        if (error instanceof git.Errors.MergeConflictError) {
          return { outcome: "conflicts", main, conflicts: error.data.filepaths };
        }
        // Both sides added the same file differently: isomorphic-git merges no such conflict.
        if (error instanceof git.Errors.MergeNotSupportedError) {
          return { outcome: "conflicts", main, conflicts: [] };
        }
        throw error;
      }
    });
  }

  /** Deletes the draft's branch and everything the working copy stored, as the draft ends. */
  delete(): Promise<void> {
    return this.#serially(async () => {
      const repo = this.ctx.storage.kv.get<string>(REPO_KEY);
      const branch = this.ctx.storage.kv.get<string>(BRANCH_KEY);
      try {
        if (repo && branch) await this.#deleteBranch(repo, branch);
      } finally {
        this.#fs = undefined;
        await this.ctx.storage.deleteAlarm();
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

/** The message of the commits merging `main` into a draft's branch. */
export const MERGE_MESSAGE = "Merge Live's code";

/**
 * Writes the merge of `theirs`, a commit of `main`, into the files of the branch `ours`, without
 * committing it (`abortOnConflict: false`): a conflict keeps both sides between markers, named
 * `draft` and `Live`. The files must hold the branch's head, as they do after a commit. `base` is
 * the commit of `main` the branch merged last. Both sides adding the same file differently, which
 * isomorphic-git doesn't merge, leaves the files as they are.
 */
async function mergeIntoFiles(
  fs: MemoryFs,
  { ours, base, theirs }: { ours: string; base: string; theirs: string },
) {
  const at = { fs, dir: CODE_ROOT };
  const head = await git.resolveRef({ ...at, ref: ours });
  await git.writeRef({ ...at, ref: OURS_REF, value: head, force: true });
  await git.writeRef({ ...at, ref: THEIRS_REF, value: theirs, force: true });
  const signature = {
    ...COMMIT_AUTHOR,
    timestamp: Math.floor(Date.now() / 1000),
    timezoneOffset: 0,
  };
  try {
    const { oid } = await git.merge({
      ...at,
      ours: OURS_REF,
      theirs: THEIRS_REF,
      fastForward: false,
      noUpdateBranch: true,
      abortOnConflict: false,
      message: MERGE_MESSAGE,
      author: signature,
      committer: signature,
    });
    // A merge without conflicts is made beside the files: they take its tree.
    await git.checkout({ ...at, ref: oid!, force: true, noUpdateHead: true });
  } catch (error) {
    if (error instanceof git.Errors.MergeNotSupportedError) return;
    if (!(error instanceof git.Errors.MergeConflictError)) throw error;
    // The merge wrote every file of its tree, but left those only `main` deleted.
    await git.walk({
      ...at,
      trees: [git.TREE({ ref: head }), git.TREE({ ref: base }), git.TREE({ ref: theirs })],
      map: async (path, [mine, before, live]) => {
        if (path === "." || !mine || (await mine.type()) !== "blob") return true;
        if (!live && before && (await before.oid()) === (await mine.oid())) {
          await git.remove({ ...at, filepath: path });
          await fs.promises.unlink(`/${path}`);
        }
        return true;
      },
    });
  }
}

/** A digest of the files' uncommitted changes: which files differ from the head, and how. */
async function uncommittedDigest(fs: MemoryFs) {
  const changed: string[] = [];
  for (const [filepath, head, workdir, stage] of await git.statusMatrix({ fs, dir: CODE_ROOT })) {
    if (head === 1 && workdir === 1 && stage === 1) continue;
    const entry = fs.entry(`/${filepath}`);
    const content = entry?.kind === "file" ? new TextDecoder().decode(entry.data) : "";
    changed.push(JSON.stringify([filepath, workdir, content]));
  }
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(changed.join("\n")));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Whether the files are what the index and the head hold: no change is uncommitted. */
async function settled(fs: MemoryFs) {
  const rows = await git.statusMatrix({ fs, dir: CODE_ROOT });
  return rows.every(([, head, workdir, stage]) => head === 1 && workdir === 1 && stage === 1);
}

/** Whether the working copy holds the object `oid`. */
async function holds(fs: MemoryFs, oid: string) {
  return git.readObject({ fs, dir: CODE_ROOT, oid }).then(
    () => true,
    () => false,
  );
}

/** The files of a commit's tree, as a build streams them. */
async function treeEntries(fs: MemoryFs, commit: string) {
  const entries: TarEntry[] = [];
  await git.walk({
    fs,
    dir: CODE_ROOT,
    trees: [git.TREE({ ref: commit })],
    map: async (path, [entry]) => {
      if (!entry || path === "." || (await entry.type()) !== "blob") return true;
      const mode = await entry.mode();
      const content = (await entry.content())!;
      if (mode === 0o120000) entries.push({ path, symlink: new TextDecoder().decode(content) });
      else entries.push({ path, mode: mode & 0o777, content });
      return true;
    },
  });
  return entries;
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
