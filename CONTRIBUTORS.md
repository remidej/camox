# Contributor guide

## Package releases with release-please

`.github/workflows/deploy.yml` runs on pushes to `main` and uses
[release-please](https://github.com/googleapis/release-please) to prepare version
bumps and changelogs from Conventional Commits.

### Contributor workflow

- Use descriptive Conventional Commit messages: `fix(sdk): ...` for bug fixes,
  `feat(cli): ...` for features, and `feat(sdk)!: ...` (or a `BREAKING CHANGE:`
  footer) for breaking changes. These select patch, minor, and major bumps,
  except that before 1.0.0 a breaking change bumps the minor version
  (`bump-minor-pre-major`). At launch, remove that option and release 1.0.0 once
  with `release-as`.
- When squash-merging, ensure the final squash commit follows this format;
  release-please reads the commits on `main`, not just the PR description.
- Let release-please manage release versions and changelogs instead of bumping
  package versions manually for each change.

### Releasing to npm

1. As changes reach `main`, release-please opens or updates a release PR with
   package version bumps, changelogs, and the version manifest.
2. A maintainer reviews the proposed versions and release notes, then merges
   the release PR when ready to ship.
3. The resulting push to `main` creates the root GitHub release, and
   release-please reports `release_created`. That starts the `deploy` job, which
   runs the checks and tests, then deploys production (see Production
   deployment). The `publish` job runs only once that deployment has succeeded,
   so no published SDK is ahead of the deployed API (ADR 0019).
4. It builds workspace packages and publishes, in order: `@camox/api-contract`,
   `@camox/ui`, `@camox/cli`, `create-camox`, and `camox`.
5. The `refresh-template` job then pushes the Template at the published version
   to `template-default` on Cloudflare Artifacts, which new projects fork
   (`packages/cli/scripts/README.md`).

`release-please-config.json` links the root and these five packages into one
version group. Package-specific GitHub releases are disabled with
`skip-github-release`; the root provides the shared GitHub release.
`.release-please-manifest.json` records the released versions. The configured
changelog sections include features, fixes, performance, refactoring,
documentation, and chores.

The `publish` job needs the repository secret `NPM_TOKEN` with permission to
publish these packages. It uses `GITHUB_TOKEN` to manage release PRs and GitHub
releases; repository settings must allow GitHub Actions to create pull requests.
Bot-created PRs using that token do not trigger workflows, so a release PR has
no checks of its own; the `deploy` job validates the release after the merge.
If it fails, the GitHub release exists but nothing is deployed or published:
fix forward, and the next release PR carries the fix.

Publishing is sequential, not atomic: if a package fails, earlier packages may
already be on npm. Check the registry and workflow logs before retrying; a rerun
can fail on an already-published version. Rerunning the whole workflow may
not report `release_created` again, which skips the deploy and the publish, so
prefer rerunning only the failed jobs.
The landing command `camox release` builds and syncs the site; it does not create
an npm release or invoke release-please.

## Dashboard route tree

Commit `apps/dashboard/src/routeTree.gen.ts`, as recommended by the
[TanStack Router FAQ](https://tanstack.com/router/latest/docs/framework/react/faq#should-i-commit-my-routetreegents-file-into-git).
Although generated, it is part of the application's runtime and supplies route
types needed for type checking on a fresh checkout.

After adding, removing, or renaming dashboard routes, run
`pnpm nx run dashboard:build --skip-nx-cache` (or the dashboard dev server), then
include the regenerated route tree in the same commit. Do not edit it manually.

## Production deployment

`.github/workflows/deploy.yml` runs the checks and tests, then deploys API,
dashboard, landing, and dispatch, each time a release PR is merged, before the
npm release of the same commit. Ordinary pushes to `main` don't deploy. To deploy
`main` without a release, run the workflow manually from the Actions tab.
Active deployments are not canceled by newer ones; only the newest pending
deployment is retained. Avoid concurrent manual deployments from your machine.

### One-time setup

Create a GitHub environment named `production`, restrict its deployment branches
to `main`, and add these environment secrets (repository secrets also work):

- `CLOUDFLARE_API_TOKEN`: scoped to the production account, with Workers deployment,
  D1 migration, R2 binding, and production zone route permissions required by the
  Wrangler configurations. Include permission to manage Workers custom domains,
  and Account › Artifacts › Edit for refreshing `template-default`. It also deploys
  the release sandbox Worker's Container and the API's `cf.artifacts.repo.pushed`
  event subscription, so it needs Containers and event subscription permissions.
- `CLOUDFLARE_ACCOUNT_ID`: the account containing the Workers and D1 database.
- `CAMOX_DEPLOY_TOKEN`: the landing project's production deploy token, used by
  `camox release` to sync its definitions.

Do not require environment approval if deployment should be fully automatic.
Existing API runtime secrets must already be configured in Cloudflare; this
workflow does not provision or replace them. The release Workflow adds the API
secrets `CF_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, the `camox-release-cache` R2
bucket, and the release sandbox Worker's R2 secrets: set them up before the
first deploy that includes it, as
[`apps/api/src/domains/releases/README.md`](apps/api/src/domains/releases/README.md#cloudflare-setup)
describes. Disable any separate Cloudflare
Git-triggered builds for these apps to avoid competing deployments.

### Deployment order

1. Validate credentials; install with the frozen lockfile.
2. Build workspace packages, run checks and tests, build dashboard, dry-run the API
   bundle and its two sandbox Workers (building the release sandbox's Container image).
3. Apply pending production D1 migrations, deploy the code mode sandbox Worker
   (`deploy:sandbox`) and the release sandbox Worker (`deploy:release-sandbox`), whose
   Durable Objects the API binds, then deploy the API.
4. Check `/health` (API availability and a D1 query).
5. Deploy dashboard, then run landing's `camox release` and deploy its Worker.

When release-please cuts a release, the `publish` job publishes the SDK once this deploy has
succeeded, `refresh-template` refreshes `template-default`, and `upgrade-projects` starts the
API's upgrade Workflow, which moves every project to the new SDK
([`apps/api/src/domains/upgrades/README.md`](apps/api/src/domains/upgrades/README.md)).

Landing's release builds and syncs against the newly deployed API, so it runs
after the API health check. It is not cached. A failed step stops subsequent
steps, but does not undo earlier deployments or production definition syncs.
The health check is a basic availability check, not full schema validation.

### Database changes

> **On `feat/drafts` and the branches built on it:** the schema is one baseline
> migration, `apps/api/migrations/0000_baseline.sql` (ADR 0013). Until
> `feat/drafts` merges, a schema change regenerates that baseline instead of
> adding a migration. See [Regenerating the baseline](#regenerating-the-baseline).

Generate and commit migration SQL in `apps/api/migrations` during development.
CI applies pending files; it never generates migrations. API tests also apply
the migrations to a local test database.

Migrations must remain compatible with the currently running API. Use
expand/contract changes: add schema, deploy compatible code, backfill, and only
remove obsolete schema in a later deployment after old consumers are retired.
Large backfills and destructive changes need a separately planned rollout.

If a migration fails, the API is not deployed. D1 rolls back the failed migration,
but earlier successful migrations can remain applied. A failed Worker deployment
also leaves successful migrations applied. Prefer a corrective commit; reverting
application code does not revert the database. Review data recovery separately
before attempting any database restore.

### Resetting the local D1

The local D1 lives in `apps/api/.wrangler/state/v3/d1`. Reset it whenever the
baseline changes, since an applied migration is never re-run. Stop
`pnpm dev` first, then from `apps/api`:

```sh
rm -rf .wrangler/state/v3/d1
pnpm db:migrate:local
pnpm seed
```

The seed prints the dev credentials. Site content comes back on the next
`pnpm dev`, when the Vite plugin syncs the playground.

### Regenerating the baseline

`0000_baseline.sql` is generated from the Drizzle schema (`apps/api/src/schema.ts`)
and holds no hand-written SQL: no views or guard triggers, since content never blocks
a definition sync (ADR 0007). After changing the schema, from `apps/api`:

```sh
rm -rf migrations && pnpm db:generate --name baseline
```

Then check that `pnpm db:generate` prints "No schema changes", run the API tests,
and reset the local D1. Commit the SQL together with `migrations/meta`.

### Unpublished packages

Internal apps use `workspace:*` dependencies. The workflow builds SDK, CLI, UI,
and API contract from the deployed commit; no npm publication is necessary.
Public npm releases are the `release-please` and `publish` jobs of the same workflow.
The production API must still support older published SDKs used by customers.

GitHub does not normally trigger another workflow for commits pushed using its
`GITHUB_TOKEN`. If automation starts committing directly to `main`, use an
appropriate GitHub App token or explicitly dispatch deployment. A user merging
a release PR triggers deployment.
