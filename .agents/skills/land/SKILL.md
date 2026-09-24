---
name: land
description: >-
  Land Camox changes directly on origin/main. Invoke only when the user explicitly
  requests landing, including Land Changes or /land, not for review, preparation,
  passing checks, or installing this skill.
disable-model-invocation: true
metadata:
  delta-action: land
---

# Land changes

Complete the requested landing in the attached Camox worktree. An explicit
invocation supplies permission to commit and push the intended changes; do not
ask for the same permission again. Do not create PRs or monitor deployments.

## Prepare

- Read applicable repository instructions and inspect status, staged and unstaged
  diffs, recent commits, and remotes. Identify the thread's intended changes,
  including any intended commits already present. Preserve unrelated work; stop
  if scope is unclear or isolating the change would overwrite someone else's work.
- Confirm `origin` is the Camox publication remote, currently
  `https://github.com/remidej/camox.git`. Never publish through `local`.
- Load the existing `conventional-commit` skill and follow it for preparing
  commits; do not duplicate its procedure here. Its authoritative source is
  `.agents/skills/conventional-commit/SKILL.md`. Use non-interactive Git commands,
  prefix editor-capable commands with `GIT_EDITOR=true`, and retain commit hooks.
- Follow `CONTRIBUTORS.md`: let release-please manage versions and changelogs.
  When dashboard routes change, regenerate and include
  `apps/dashboard/src/routeTree.gen.ts` using the dashboard build, not manual
  edits. When database schema changes, include generated migration SQL and
  preserve compatibility with the currently running API; pause for destructive
  migrations or large backfills needing a separate rollout. A package release
  needs maintainer review and explicit publication intent; ordinary landing must
  not merge release-please work or publish packages incidentally.
- Use the repository's pinned pnpm version (`package.json`: `pnpm@11.1.3` at
  setup). CI uses Node 22; use a compatible runtime and investigate version-related
  failures rather than bypassing them. Do not install system tools or read secrets.

## Integrate and verify

1. Fetch `origin/main` and integrate it with the intended work on an isolated
   local branch if necessary. Use a fast-forward where possible, otherwise a
   non-interactive merge; do not rewrite shared history. Commit only intended
   changes. Do not automatically stash unrelated work.
2. Resolve conflicts automatically when the intended result is clear, preserving
   unrelated changes. Pause and explain ambiguous or unsafe conflicts. After any
   resolution, inspect the complete result and repeat verification.
3. Install workspace dependencies when needed with
   `pnpm install --frozen-lockfile`
   (source: `.github/workflows/ci.yml`, with version pinned in `package.json`).
4. Build missing workspace package outputs before checking if imports such as
   `camox/*` cannot resolve:
   `pnpm nx run-many -t build --projects=tag:type:pkg`
   (source: `.github/workflows/deploy.yml`; package build scripts and `nx.tags`
   in `packages/*/package.json`, dependency ordering in `nx.json`).
   This is preparation, not an exemption from checks.
5. Run the repository's local equivalents of PR CI in order:

   ```sh
   pnpm check
   pnpm test
   pnpm exec nx run camox:build
   pnpm --filter camox exec tsx --test src/features/vite/vite.test.ts
   pnpm --filter @camox/template-default test:production
   ```

   Sources: `.github/workflows/ci.yml` defines these exact invocations;
   root `package.json` defines `check` and `test`; `packages/sdk/package.json`
   defines the `camox` build and `tsx` dependency, with the test entry point at
   `packages/sdk/src/features/vite/vite.test.ts`;
   `apps/template-default/package.json` defines `test:production`.
   Also run targeted tests appropriate to the changed behavior that CI does not
   cover, using the current repository's test definitions.

6. For dashboard route changes, use `pnpm nx run dashboard:build`
   (source: `.github/workflows/deploy.yml` and the dashboard build script in
   `apps/dashboard/package.json`), ensuring generation actually runs rather than
   relying on stale outputs. Review and include the generated route tree.
7. Review hook-generated or build-generated changes before including them.
   Run `git diff --check`. All required verification must pass on the final
   changes being pushed, not an earlier version. Rerun affected verification after
   any subsequent changes, including hook fixes or integration of a newer base.
   Pending, failing, missing, or unverifiable required checks block landing,
   including failures believed to predate the change. Do not disable hooks,
   weaken checks, or modify unrelated code simply to get a green result.

## Push and confirm

- Recheck the intended outgoing diff and commits against fresh `origin/main`.
  Ensure no unrelated changes or commits would be published.
- Push the verified result directly with `git push origin HEAD:main`. Never
  force-push. If main advances, fetch and integrate it, repeat verification, and
  retry the normal push. If permissions or a server rule rejects the push, report
  the blocker rather than bypassing it.
- Verify the destination using `git ls-remote origin refs/heads/main` and a fetch.
  Confirm the landed commit is the destination tip or an ancestor of the new tip.
  A local commit or successful topic-branch push is not landing success.
- Leave release and deployment automation alone. Do not wait for or inspect the
  resulting deployments, manually deploy, publish packages, or delete branches
  as part of this workflow.

## Report

When running in a subthread and `report_subthread_status` is available, report the
landing result to the parent with it; otherwise report in the current conversation.
Use `success` only after verifying the changes reached `origin/main`. Use
`failure` for an unsuccessful attempt or genuine blocker, explaining that the
changes have not landed. Safe recovery may continue; report the updated result
after verification.

Keep the title to a few sentence-case words and the description to one short
line. Link the landed commit by short SHA only after verifying its actual URL.
Link an actual CI check or run only if one was used and its result and URL were
verified; local checks do not have a CI URL. Never fabricate a link or seek out
deployment runs merely for reporting.

Examples without remote CI:

- Success title: `Landed on main`; description: a verified short-SHA commit link
  followed by `Local checks passed.`
- Failure title: `Blocked by checks`; description: `Local verification failed.
Not landed.`

Ask any necessary questions in the conversation, not in status events. Do not
report skill installation, a passing build, or routine progress as landing success.
