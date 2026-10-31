---
name: ship
description: "Land the PRs of other threads, merge the release they produce, and see the deploy through."
disable-model-invocation: true
---

You're given threads, or PR numbers. The goal: every PR merged, the release PR merged, and the Deploy run green on every job.

If the user named no threads or PRs, ask which ones to ship before doing anything.

This repo has no PR checks. A thread waiting on CI is waiting on nothing.

## Steps

1. **Find the PRs.** Map each thread to its PR (`list_thread_pull_requests`). A thread with no PR yet is still working: `t3_thread_wait` with `untilDelegatedWorkSettled`, then look again. Done when every input has a PR.

2. **Land each PR.** A PR is ready when its thread has settled and its last report names no unfinished work. Known gaps the thread reports as follow-ups don't block it; carry them to your report. Draft or "ready for review" doesn't matter; the thread's report does.
   - Ready and mergeable: `gh pr merge --squash` yourself.
   - Conflicting: nudge the owning thread with `t3_thread_send`, since it knows its side best. Name the PR that landed and the files in conflict, and ask it to merge `main`, resolve, run the affected tests, push, and `gh pr merge --squash`.
   - Each merge can make the next PR conflict: re-check mergeability before every merge.

   Done when every PR shows `MERGED`.

3. **Merge the release.** Wait for the Release PR run on the last merge commit to finish. Check the release PR's notes list every PR you landed, then squash-merge it.

4. **Watch the deploy.** The release changes `.release-please-manifest.json`, which starts Deploy. Run `gh run watch <id> --exit-status` in the background and wait on it with `t3_background_wait`. Done when every job is `success`.

5. **Fix a failure.** Read the failed job's log and decide:
   - Flaky (a timeout under load, a runner hiccup): `gh run rerun <id> --failed`, then back to step 4.
   - A bug: fix it, commit the fix straight to `main` as a `fix:`, and ship it as a release: back to step 3 with the patch release PR it produces. Every redeploy goes through a release, because a manual Deploy run deploys `main` without one and leaves the published SDK out of step with the API.

6. **Report:** the PRs landed, each nudge and why, the release version, the deploy result with any fix you made, and the follow-ups the threads left open.
