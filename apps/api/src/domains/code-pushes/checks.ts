import git from "isomorphic-git";
import http from "isomorphic-git/http/web";

import { type PreparedCommit, treeEntries } from "../../durable-objects/draft-code";
import { MemoryFs } from "../../lib/memory-fs";
import { tar } from "../../lib/tar";
import type { Bindings } from "../../types";
import { CODE_ROOT } from "../code/main-copy";
import { type TreeFiles, unwritableChanges, WRITABLE } from "../code/write-line";
import { readAccess } from "../projects/code-access";
import type { Bundle } from "./bundle";

// The checks a push passes before anything is written (ADR 0026), but its build: they read the
// pushed commits beside a copy of the current `main`, held in memory.

/** Why a push was refused: each reason is a stable code the CLI and its users can rely on. */
export type PushRefusalReason =
  /** What was sent isn't a Git bundle of one branch's commits. */
  | "invalidBundle"
  /** The pushed tree changes a platform-owned file, which only Upgrades change. */
  | "platformFile"
  /** The pushed tree adds or changes a file under `src/` that isn't TypeScript or CSS. */
  | "notCode"
  /** `main` changed a platform-owned file since the branch last merged it. */
  | "mergeMainFirst"
  /** The branch starts from a commit that was never on `main`. */
  | "baseNotOnMain"
  /** The branch doesn't merge cleanly with the current `main`. */
  | "conflictsWithMain"
  /** The pushed head doesn't build. */
  | "doesNotBuild"
  /** The pushed head doesn't include the draft's current head. */
  | "pullDraftFirst"
  /** The draft the push names was published or deleted. */
  | "draftEnded";

export type PushRefusal = {
  reason: PushRefusalReason;
  message: string;
  data?: Record<string, unknown>;
};

/** A push that passed the checks: its head, as a commit to build, and what landing it needs. */
export type CheckedPush = {
  /** The pushed head, as a commit to build. */
  prepared: PreparedCommit;
  /**
   * The commits of `main` or of the draft's branch the pushed commits build on: the bundle's
   * prerequisites.
   */
  prerequisites: string[];
  /** The newest commit of `main` the pushed head holds, which a draft it opens forks from. */
  base: string;
  pack: Uint8Array;
  /** The subject of each pushed commit, oldest first. */
  subjects: string[];
};

/** The refusal of a push that doesn't include the draft's current head. */
export const PULL_DRAFT_FIRST: PushRefusal = {
  reason: "pullDraftFirst",
  message:
    "The draft has commits your branch doesn't: pull the draft first (`git pull`), then push again.",
};

/** The refusal of a push whose body isn't a Git bundle of one branch's new commits. */
export const INVALID_BUNDLE: PushRefusal = {
  reason: "invalidBundle",
  message: "Camox expects a Git bundle of one branch's new commits.",
};

/** The refusal of a push to a draft that ended, as `ended` says, such as "was published". */
export const draftEnded = (ended: string): PushRefusal => ({
  reason: "draftEnded",
  message: `This draft ${ended}, so it takes no more pushes: start a new branch from \`main\`, then push it to open a new draft.`,
});

/** How long the read token the checks fetch with lasts: only for the fetches of one push. */
const CHECKS_READ_TOKEN_TTL_SECONDS = 10 * 60;
/** Where the bundle's packfile is indexed. */
const PACK = ".git/objects/pack/pack-push.pack";
/** The local ref the pushed head is merged from. */
const PUSHED_REF = "refs/heads/camox-push";
const MAIN_REF = "refs/heads/main";
/** The local ref of the branch of the draft the push lands on, when it has one. */
const DRAFT_REF = "refs/heads/camox-draft";

const listed = (paths: string[]) => paths.map((path) => `\`${path}\``).join(", ");

/**
 * Checks the bundle `bundle`'s commits against the current `main` of the project's repo `repo`,
 * and against the branch `draftBranch` of the draft they land on, when it has one: they must
 * then include its head, and may build on its commits as well as on `main`'s.
 */
export async function checkPush(
  env: Bindings,
  { repo, bundle, draftBranch }: { repo: string; bundle: Bundle; draftBranch?: string },
): Promise<{ refused: PushRefusal } | { checked: CheckedPush }> {
  const refused = (reason: PushRefusalReason, message: string) => ({
    refused: { reason, message },
  });
  const [pushed, ...others] = bundle.refs;
  if (!pushed || others.length > 0 || bundle.prerequisites.length === 0) {
    return { refused: INVALID_BUNDLE };
  }
  const fs = new MemoryFs();
  const at = { fs, dir: CODE_ROOT };
  const { remote, token } = await readAccess(env, repo, CHECKS_READ_TOKEN_TTL_SECONDS);
  const headers = { Authorization: `Bearer ${token.plaintext}` };
  await git.clone({
    ...at,
    http,
    url: remote,
    headers,
    ref: "main",
    singleBranch: true,
    noCheckout: true,
  });
  if (draftBranch) {
    const { fetchHead } = await git.fetch({
      ...at,
      http,
      url: remote,
      headers,
      remoteRef: draftBranch,
      singleBranch: true,
      tags: false,
    });
    await git.writeRef({ ...at, ref: DRAFT_REF, value: fetchHead!, force: true });
  }
  const main = await git.resolveRef({ ...at, ref: MAIN_REF });
  const draftHead = draftBranch ? await git.resolveRef({ ...at, ref: DRAFT_REF }) : undefined;

  for (const prerequisite of bundle.prerequisites) {
    if (draftHead && (await isAncestor(fs, draftHead, prerequisite))) continue;
    if (!(await isAncestor(fs, main, prerequisite))) {
      return refused(
        "baseNotOnMain",
        "Your branch starts from a commit that was never on `main`: start it from `main`, then push again.",
      );
    }
  }
  const head = pushed.oid;
  let subjects: string[];
  try {
    await fs.promises.writeFile(`/${PACK}`, bundle.pack);
    await git.indexPack({ ...at, filepath: PACK });
    subjects = await walkToPrerequisites(fs, head, new Set(bundle.prerequisites));
  } catch {
    return refused("invalidBundle", "Camox couldn't read the commits in your push's Git bundle.");
  }
  if (draftHead && !(await isAncestor(fs, head, draftHead))) return { refused: PULL_DRAFT_FIRST };

  const [base] = await git.findMergeBase({ ...at, oids: [head, main] });
  const [headFiles, mainFiles, baseFiles] = await Promise.all(
    [head, main, base!].map((commit) => filesOf(fs, commit)),
  );
  const unwritable = unwritableChanges(headFiles, mainFiles);
  // A file the branch has as it was where it last merged `main` is one `main` changed since.
  const ours = unwritable.filter(({ path }) => headFiles.get(path) !== baseFiles.get(path));
  const platform = ours.filter(({ why }) => why === "platformOwned").map(({ path }) => path);
  if (platform.length > 0) {
    return refused(
      "platformFile",
      `Your branch changes files that only Upgrades change: ${listed(platform)}. A push may only change ${WRITABLE}: put those files back as they are on \`main\`.`,
    );
  }
  const notCode = ours.map(({ path }) => path);
  if (notCode.length > 0) {
    return refused(
      "notCode",
      `Your branch adds or changes files under \`src/\` that aren't TypeScript or CSS: ${listed(notCode)}. Images and media go in the studio, as files.`,
    );
  }
  if (unwritable.length > 0) {
    return refused(
      "mergeMainFirst",
      `\`main\` changed files that only Upgrades change since your branch last merged it: ${listed(unwritable.map(({ path }) => path))}. Merge \`main\` first, then push again.`,
    );
  }

  // A draft's own merges of `main` are Camox's: its agent reconciles them, as for any draft.
  const conflicts = draftHead ? undefined : await conflictsWithMain(fs, head, base!, main);
  if (conflicts) {
    return refused(
      "conflictsWithMain",
      `Your branch doesn't merge with \`main\`${conflicts.length > 0 ? `, in ${listed(conflicts)}` : ""}. Merge \`main\` and resolve the conflicts, then push again.`,
    );
  }

  const { commit } = await git.readCommit({ ...at, oid: head });
  const entries = await treeEntries(fs, head);
  const lockfile = entries.find(({ path }) => path === "pnpm-lock.yaml");
  return {
    checked: {
      prepared: {
        commit: head,
        tree: commit.tree,
        files: tar(entries),
        lockfile:
          lockfile && "content" in lockfile ? new TextDecoder().decode(lockfile.content) : null,
      },
      prerequisites: bundle.prerequisites,
      base: base!,
      pack: bundle.pack,
      subjects,
    },
  };
}

/** Whether `commit` is `tip` or one of its ancestors. */
async function isAncestor(fs: MemoryFs, tip: string, commit: string) {
  if (commit === tip) return true;
  return git
    .isDescendent({ fs, dir: CODE_ROOT, oid: tip, ancestor: commit, depth: -1 })
    .catch(() => false);
}

/**
 * Reads every commit from `head` down to the prerequisites, throwing at one that's missing.
 * Returns their subjects, oldest first.
 */
async function walkToPrerequisites(fs: MemoryFs, head: string, prerequisites: Set<string>) {
  const seen = new Set<string>();
  const commits: { subject: string; timestamp: number }[] = [];
  const walk = [head];
  while (walk.length > 0) {
    const oid = walk.pop()!;
    if (seen.has(oid) || prerequisites.has(oid)) continue;
    seen.add(oid);
    const { commit } = await git.readCommit({ fs, dir: CODE_ROOT, oid });
    commits.push({
      subject: commit.message.split("\n")[0]!.trim(),
      timestamp: commit.committer.timestamp,
    });
    walk.push(...commit.parent);
  }
  // Newest first as walked; a stable sort keeps commits of the same second in walk order.
  return commits
    .reverse()
    .sort((a, b) => a.timestamp - b.timestamp)
    .map(({ subject }) => subject);
}

/** A commit's files, each by its mode and blob. */
async function filesOf(fs: MemoryFs, commit: string): Promise<TreeFiles> {
  const files = new Map<string, string>();
  await git.walk({
    fs,
    dir: CODE_ROOT,
    trees: [git.TREE({ ref: commit })],
    map: async (path, [entry]) => {
      if (!entry || path === "." || (await entry.type()) !== "blob") return true;
      files.set(path, `${(await entry.mode()).toString(8)} ${await entry.oid()}`);
      return true;
    },
  });
  return files;
}

/**
 * The files `head` and `main` both changed since `base` in ways that don't merge, or undefined
 * when they merge cleanly. Both sides adding the same file differently, which isomorphic-git
 * doesn't merge, conflicts without naming files.
 */
async function conflictsWithMain(fs: MemoryFs, head: string, base: string, main: string) {
  if (base === main) return undefined;
  const at = { fs, dir: CODE_ROOT };
  await git.writeRef({ ...at, ref: PUSHED_REF, value: head, force: true });
  const signature = { name: "Camox", email: "agent@camox.ai", timestamp: 0, timezoneOffset: 0 };
  try {
    await git.merge({
      ...at,
      ours: PUSHED_REF,
      theirs: MAIN_REF,
      fastForward: false,
      noUpdateBranch: true,
      abortOnConflict: true,
      dryRun: true,
      author: signature,
      committer: signature,
    });
    return undefined;
  } catch (error) {
    if (error instanceof git.Errors.MergeConflictError) return error.data.filepaths;
    if (error instanceof git.Errors.MergeNotSupportedError) return [];
    throw error;
  }
}
