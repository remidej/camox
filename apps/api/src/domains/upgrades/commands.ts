// The commands a project's upgrade runs in its sandboxes, one per step (`project-workflow.ts`).
//
// Each step after the first starts from the workspace the previous one left, but `@cloudflare/ci`
// then copies the commit's tracked files back over it, so a step's changes to tracked files are
// lost. The update step therefore saves the upgraded `package.json` and lockfile in
// `UPGRADED_FILES`, which the commit doesn't track, and each later step puts them back first.

/** The files an upgrade changes, and commits. */
const PLATFORM_FILES = "package.json pnpm-lock.yaml";

/** Where the update step saves the upgraded files for the steps after it. */
const UPGRADED_FILES = ".camox-upgrade";

const restoreUpgradedFiles = `cp ${UPGRADED_FILES}/package.json ${UPGRADED_FILES}/pnpm-lock.yaml .`;

/** Moves the Camox packages to the new version with `setVersions`, then installs and saves them. */
export function updateCommand(setVersions: string) {
  return [
    setVersions,
    "pnpm install --no-frozen-lockfile",
    `mkdir -p ${UPGRADED_FILES}`,
    `cp ${PLATFORM_FILES} ${UPGRADED_FILES}/`,
  ].join(" && ");
}

/** Builds the upgraded website as a release would, for Live, without syncing anything. */
export function buildCommand() {
  return `${restoreUpgradedFiles} && pnpm exec camox release --dry-run`;
}

/**
 * Commits the upgraded `package.json` and lockfile on top of the current `main`, and pushes it.
 * `main` may have moved since the commit the upgrade built, by a publish with code, which only
 * ever changes `src/`: the step checks that `package.json` and the lockfile are still that
 * commit's, and refuses otherwise. The workspace has no `.git`, so the step fetches both commits
 * first. A `main` that already has the upgraded files, as after a retried push that landed, is
 * left as it is. A `main` that moves during the step is refused, rather than overwritten.
 */
export function pushCommand(sha: string, camoxVersion: string) {
  return [
    restoreUpgradedFiles,
    "git init -q",
    'git remote add origin "$UPGRADE_GIT_REMOTE"',
    `git fetch -q --depth=1 origin ${sha} refs/heads/main:refs/remotes/origin/main`,
    "git reset -q origin/main",
    `if git diff --quiet -- ${PLATFORM_FILES}; then exit 0; fi`,
    `git diff --quiet ${sha} origin/main -- ${PLATFORM_FILES}`,
    `git add ${PLATFORM_FILES}`,
    `git commit -q -m "Upgrade Camox to ${camoxVersion}"`,
    "git push -q origin HEAD:refs/heads/main",
  ].join(" && ");
}
