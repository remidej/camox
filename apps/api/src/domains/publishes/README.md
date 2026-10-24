# Publishes with code

Publishing a draft with code puts its code and content on Live at the same moment, serving exactly the build members previewed (ADR 0020 and its amendments, spec #560 section 13). A draft without code publishes as before, in the request (`../drafts/publish.ts`).

`drafts.publish` takes the revision the review showed (`code.revision`). It refuses a revision that isn't the one the draft previews, or changes still building (`REVISION_CHANGED`). Otherwise it puts the draft in its publishing state (`drafts.publishing_revision_id`), starts the `camox-publish` Workflow (`workflow.ts`) and returns `{ publishing: true }` at once. The review shows "Publishing…" from the preview's `code.publishing`. Viewers learn the outcome through the project room: `draftEnded` when it lands, and a `drafts` invalidation, refreshing the review, when it goes back to it, with `code.publishAborted` saying why.

## Steps

A project's publishes with code run one at a time, in the order they were asked for, with an Upgrade ready to push to `main` (`queue.ts`): the drafts in their publishing state and the project's `upgrade_push_*` columns are the queue. Each publish waits for its turn, and wakes the next with a `publish-turn` event when it ends, however it ends. An Upgrade checks its turn every few seconds, and wakes the next publish once it pushed.

1. **The pinned revision must be the draft's head**, and the one it previews. A newer one goes back to the review (`revisionChanged`). A head whose build was pruned is built again in the draft's sandbox. When `main` moved and the draft hasn't merged it yet, the publish waits for its merge revision (`../revisions/merge.ts`), woken by a `draft-merged` event, and ships that: the head may be merges of `main` on top of the pinned revision, never an agent's revision. It ships once the draft previews the merge and it type checks. A merge that clashes or fails its type check goes back to the draft with the "doesn't merge with Live's" blocker (`codeDoesNotMerge`), as Camox's reconcile turn fixes it (`../revisions/reconcile.ts`); one that takes more than `MERGE_CHECKS` checks goes back to the review (`liveCodeMoved`).
2. **Upload without serving**: the publish sandbox (below) unpacks the revision's archive from `REVISION_BUILDS` and runs `wrangler versions upload` with `--var CAMOX_PUBLISHING_DRAFT:<draft>`.
3. **Re-check** Live's conflicts against the review's token, and blockers. Either goes back to the review, Live untouched.
4. **Promote** with `wrangler versions deploy <version>@100%`, after reading the version Live served (`deployments status --json`). From here until the batch commits, the new version's reads name the draft with `x-camox-publishing-draft`: the API reads them as Live overlaid with the draft while it's publishing, with no session, and as Live otherwise (`../drafts/access.ts`).
5. **The publish batch** (`publishWithCode`): the draft's content as any publish applies it, with the draft's definitions, which its previewed revision synced, replacing Live's. It aborts when the conflicts changed, or when the draft previews another revision. Then the previous version is promoted back and the draft goes back to its review.
6. **Record the tree Live serves**: a succeeded `releases` row for this publish, so the next step's push releases nothing (`../releases/README.md`).
7. **Push one squashed commit to `main`**: the revision's tree, with the current `main` as its parent (`DraftCode.publishToMain`).
8. **Delete the draft's code**: its branch, R2 builds, working copy and sandbox (`discardCode`).

A step that gives up puts the draft back to its review (`failed`). One after the batch leaves Live published, and `main` behind it until someone pushes again.

The publish never builds, except a pruned head (step 1), and never installs or runs `camox release`: agent-written code never runs beside the Deploy Token.

## Upgrades

An Upgrade's push to `main` joins the project's queue (`../upgrades/project-workflow.ts`), so it never lands between a publish's promotion and its push to `main`, which would release `main` without the draft's code over Live, and the publish's squashed commit would then undo the Upgrade. Its push lands on the current `main`: it commits only `package.json` and the lockfile, after checking they're still those of the commit it built, which publishes never change. Publishes asked for after it wait for its push, then for their draft's merge of it. Drafts merge a push only once its release ended (`../releases/workflow.ts`), so a publish shipping the merge is promoted over the Upgrade's release, never under it.

## Tests

`workflow.integration.test.ts` drives publishes through `drafts.publish`, with wrangler, the sandboxes and Artifacts faked at their bindings (`test/release-fakes.js`). The fake publish sandbox records every command, keeps each project's Worker versions and deployments, and can fail or hold any command, per project.

## Cloudflare setup

- The release sandbox Worker gains the `PublishSandbox` Container (`release-sandbox/publish.Dockerfile`, wrangler only, `basic`), deployed with `pnpm run deploy:release-sandbox`. The API binds it as `PUBLISH_SANDBOX`.
- `wrangler deploy` creates the `camox-publish` Workflow. The publish sandbox gets the API's `CF_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, as a release's `deploy` step does.
- Untested on real infrastructure: whether `wrangler versions upload`/`versions deploy`/`deployments status` take `--dispatch-namespace` for a user Worker in the `production` namespace. If they don't, step 2 and 4 move to the Workers for Platforms API.
