# Upgrades

Every SDK publish upgrades every project to it (GLOSSARY.md), so that the API only bridges old SDKs briefly (ADR 0019). The `upgrade-projects` job of `.github/workflows/deploy.yml` starts the `camox-upgrade` Workflow (`workflow.ts`) with the published version, once `template-default` is refreshed. The API it runs against is already deployed, since the SDK is published only after it.

## Steps

The upgrade lists every project but those whose setup failed, which already alerted Rémi, then goes through them in batches. For each project, it reads the commit `main` points to and the `camox` version its `pnpm-lock.yaml` installs. A project already on that version or a newer one is left alone, so re-running an upgrade only redoes the projects it didn't move. Any other project gets its own `camox-project-upgrade` Workflow instance (`project-workflow.ts`), which runs on `@cloudflare/ci` in the release sandboxes, on that commit:

1. **`bump`:** sets every Camox package the project depends on (`camox`, `@camox/*`) to `^<version>` in its `package.json` with `npm pkg set`, then `pnpm install --no-frozen-lockfile` updates the lockfile.
2. **`build`:** `pnpm exec camox release --dry-run`, which builds the website as a release would, for Live, without logging in or syncing its definitions.
3. **`push`:** commits only `package.json` and `pnpm-lock.yaml`, as "Upgrade Camox to <version>", on top of the commit it built, and pushes it to `main`. That push releases the project (`../releases/README.md`). If `main` moved during the upgrade, the push is refused rather than overwriting it. The commit's author and dates are fixed, so a retried push makes the same commit and pushes nothing new.

Nothing else changes a project's code: no codemods, no agent fixes. A project whose bump or build fails isn't pushed, so its `main` stays as it was and it keeps serving its previous release.

Each project upgrade tells the upgrade how it ended with an event. If none comes within two hours, the upgrade reads the instance's status instead.

## Throttling

Each project that builds is released, and its release deploys its Worker with Camox's Cloudflare token, which Cloudflare limits to 1,200 API requests per 5 minutes. A deploy takes a dozen or so. The upgrade runs at most `PROJECTS_PER_BATCH` (10) project upgrades at once, and starts a batch at most once every 5 minutes, so at most two batches' releases deploy within any 5 minutes: a few hundred requests, leaving room for releases and setups outside the upgrade. It also leaves the release sandbox Worker's 20 containers room for the releases the pushes start. 300 projects take about two and a half hours.

## When projects don't build

Once every project is done, one alert goes to the alerts address (`src/lib/alert-email.ts`), listing each project that wasn't upgraded: its name, its Project ID, the step that failed, and a link to its project upgrade's Workflow instance, where its logs are. A project whose repo can't be read, or has no `main`, is listed too. The alert links to the upgrade's own instance. Rémi fixes those projects by hand, and they hold the API's old shapes in place until he does.

## Tests

`workflow.integration.test.ts` runs both Workflows in the Workers pool, with Cloudflare Artifacts, the sandboxes and the `EMAIL` binding faked at their bindings (`test/release-fakes.js`), as the release tests do. `packages/sdk/src/features/vite/afterSync.test.ts` and `packages/cli/test/release.test.mjs` cover the dry-run build.

```sh
pnpm --filter @camox/api exec vp test --run --project integration src/domains/upgrades
```

## Cloudflare setup

Nothing to create: `wrangler deploy` creates both Workflows, which reuse the release Workflow's sandboxes, cache bucket and alerts address (`../releases/README.md#cloudflare-setup`).

The `upgrade-projects` job starts the upgrade through Cloudflare's REST API (`POST /accounts/<account>/workflows/camox-upgrade/instances`) with the `production` environment's `CLOUDFLARE_API_TOKEN`. Starting a Workflow instance needs **Account › Workers Scripts › Edit**, which the token already has to deploy Workers. If the job's first run is refused with a 403, check that permission on the token.

To upgrade every project by hand, such as after fixing projects that didn't build:

```sh
pnpm --filter @camox/api exec wrangler workflows trigger camox-upgrade '{"camoxVersion":"<version>"}'
```
