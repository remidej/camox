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

Complete the requested landing in the current Camox worktree. An explicit
invocation supplies permission to commit and push the intended changes; do not
ask for the same permission again. Do not create PRs or monitor deployments.

## Reuse development context

Landing integrates and publishes work; it is not a second implementation review
or a mandatory replay of PR CI. Reuse reviewed diffs and successful verification
when they still cover the final changes, dependencies, configuration, and base.

In Delta, use the current thread's implementation, review, and tool results
(including an available parent handoff). Inspect what changed since those results
rather than restarting discovery or delegating another review by default.
Outside Delta, use available session context or a handoff in the same way. If
evidence is missing or stale, inspect and verify the uncovered work; do not assume
checks passed. Always inspect current Git status and the outgoing diff and commits.

## Prepare

- Read applicable repository instructions and inspect status and remotes. Review
  staged and unstaged diffs not already covered by current context; inspect
  recent commits only as needed to establish scope and history. Identify the
  intended changes, including any intended commits already present. Preserve unrelated work; stop
  if scope is unclear or isolating the change would overwrite someone else's work.
- Confirm `origin` is the Camox publication remote, currently
  `https://github.com/remidej/camox.git`. Never publish through `local`.
- Use Conventional Commit subjects: `type(scope): short imperative summary`.
  Scope is optional; types are `feat`, `fix`, `docs`, `style`, `refactor`, `perf`,
  `test`, `build`, `ci`, `chore`, and `revert`. Add a brief body when useful to
  explain why. Follow `CONTRIBUTORS.md` for breaking-change markers. Never add
  `Co-Authored-By:` trailers or agent/tool attribution. These conventions are
  sufficient here; do not load `conventional-commit` as an additional procedure.
- Stage only intended files or hunks and verify the staged diff. Use
  non-interactive Git commands, prefix editor-capable commands with
  `GIT_EDITOR=true`, and retain commit hooks.
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

## Integrate

1. Fetch `origin/main` and integrate it with the intended work on an isolated
   local branch if necessary. Use a fast-forward where possible, otherwise a
   non-interactive merge; do not rewrite shared history. Commit only intended
   changes. Do not automatically stash unrelated work. Record the fetched main
   SHA as the verification base; do not rely on a potentially stale local `main`.
2. Resolve conflicts automatically when the intended result is clear, preserving
   unrelated changes. Pause and explain ambiguous or unsafe conflicts. After any
   resolution, inspect the complete result and rerun affected verification.
3. Install workspace dependencies when needed with
   `pnpm install --frozen-lockfile`
   (source: `.github/workflows/ci.yml`, with version pinned in `package.json`).
4. Build missing workspace package outputs before checking if imports such as
   `camox/*` cannot resolve:
   `pnpm nx run-many -t build --projects=tag:type:pkg`
   (source: `.github/workflows/deploy.yml`; package build scripts and `nx.tags`
   in `packages/*/package.json`, dependency ordering in `nx.json`).
   This is preparation, not an exemption from checks.
5. For dashboard route changes, use
   `pnpm nx run dashboard:build --skip-nx-cache`
   (source: `.github/workflows/deploy.yml` and the dashboard build script in
   `apps/dashboard/package.json`), ensuring generation actually runs rather than
   relying on stale outputs. Review and include the generated route tree.

## Verify once

- Reuse successful checks that cover the final state. Do not run root
  `pnpm check` merely because landing started; use hook coverage and the scoped
  verification below unless applicable repository instructions require more.
- Let commits run the hooks, rather than manually running `vp staged` first.
  `.vite-hooks/pre-commit` runs `vp staged`; `vite.config.ts` configures affected
  project checks and staged formatting. `.vite-hooks/commit-msg` runs commitlint.
  These hooks do **not** run tests. Reuse their successful coverage, but do not
  assume staged-file checks verified every outgoing commit. If hooks are not
  installed, use the repository's `pnpm exec vp config` setup; never bypass them.
- For behavior changes, reuse relevant passing tests or run the missing tests.
  After committing the intended changes, the default scoped suite is:

  ```sh
  pnpm exec nx affected -t test --base=<fetched-main-sha> --head=HEAD
  ```

  Use the recorded SHA, not the literal placeholder. This covers the full
  outgoing range, including already-committed changes. Use the same range with
  `-t check` if project-check coverage is missing. Do not use `--head=HEAD` to
  validate uncommitted changes. Include targeted tests outside Nx as appropriate
  (for example, `pnpm test:dev` for changes to `scripts/dev.mjs`).

- Run the SDK integration checks from `.github/workflows/ci.yml` when changes
  affect SDK/Vite integration, packaging, production templates, or their shared
  dependencies/configuration and current passing results do not cover them:

  ```sh
  pnpm exec nx run camox:build
  pnpm --filter camox exec tsx --test src/features/vite/vite.test.ts
  pnpm --filter @camox/template-default test:production
  ```

  For broad tooling/dependency changes or uncertain impact, run the full PR CI
  suite (`pnpm check`, `pnpm test`, then the three commands above), reusing valid
  results. Documentation-only changes do not need runtime tests or builds.
  Direct pushes to main do not trigger the pull-request-only CI workflow, so
  never defer required local verification to a presumed post-push CI run.

- Review hook/build-generated changes before including them. Inspect the final
  commit as well as any remaining working-tree changes: hooks can modify files.
  Run `git diff --check <fetched-main-sha> HEAD` for the outgoing changes.
  After hook fixes, conflict resolutions, or integration of a newer base, rerun
  checks whose inputs changed, not automatically every check.
- Pending, failing, missing, or unverifiable required checks block landing,
  including failures believed to predate the change. Do not disable hooks,
  weaken checks, or modify unrelated code simply to get a green result.

## Push and confirm

- Recheck the intended outgoing diff and commits against fresh `origin/main`.
  Ensure no unrelated changes or commits would be published.
- Push the verified result directly with `git push origin HEAD:main`. Never
  force-push. If main advances, fetch and integrate it, update the verification
  base, rerun affected verification, and retry the normal push. If permissions
  or a server rule rejects the push, report
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
