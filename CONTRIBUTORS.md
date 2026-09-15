# Contributor guide

## Package releases with release-please

`.github/workflows/release.yml` runs on pushes to `main` and uses
[release-please](https://github.com/googleapis/release-please) to prepare version
bumps and changelogs from Conventional Commits.

### Contributor workflow

- Use descriptive Conventional Commit messages: `fix(sdk): ...` for bug fixes,
  `feat(cli): ...` for features, and `feat(sdk)!: ...` (or a `BREAKING CHANGE:`
  footer) for breaking changes. These normally select patch, minor, and major
  bumps respectively.
- When squash-merging, ensure the final squash commit follows this format;
  release-please reads the commits on `main`, not just the PR description.
- Let release-please manage release versions and changelogs instead of bumping
  package versions manually for each change.

### Releasing to npm

1. As changes reach `main`, release-please opens or updates a release PR with
   package version bumps, changelogs, and the version manifest.
2. A maintainer reviews the proposed versions and release notes, then merges
   the release PR when ready to publish.
3. The resulting push to `main` creates the root GitHub release. The workflow's
   `publish` job runs only when release-please reports `release_created`.
4. It builds workspace packages and publishes, in order: `@camox/api-contract`,
   `@camox/ui`, `@camox/cli`, `create-camox`, and `camox`.

`release-please-config.json` links the root and these five packages into one
version group. Package-specific GitHub releases are disabled with
`skip-github-release`; the root provides the shared GitHub release.
`.release-please-manifest.json` records the released versions. The configured
changelog sections include features, fixes, performance, refactoring,
documentation, and chores.

The release workflow needs the repository secret `NPM_TOKEN` with permission to
publish these packages. It uses `GITHUB_TOKEN` to manage release PRs and GitHub
releases; repository settings must allow GitHub Actions to create pull requests.
Bot-created PRs using that token do not normally trigger PR CI automatically, so
ensure validation has run before merging a release PR.

Publishing is sequential, not atomic: if a package fails, earlier packages may
already be on npm. Check the registry and workflow logs before retrying; a rerun
can fail on an already-published version, and rerunning the whole workflow may
not report `release_created` again.

Package releases are separate from hosted app deployments: ordinary pushes to
`main` deploy the apps without waiting for a release PR or npm publication.
The landing command `camox release` builds and syncs the site; it does not create
an npm release or invoke release-please.

## Production deployment

`.github/workflows/deploy.yml` deploys API, dashboard, and landing on pushes to
`main`, independently of npm releases. It can also be rerun manually on `main`.
Active deployments are not canceled by new commits; only the newest pending run
is retained. Avoid concurrent manual deployments from your machine.

### One-time setup

Create a GitHub environment named `production`, restrict its deployment branches
to `main`, and add these environment secrets (repository secrets also work):

- `CLOUDFLARE_API_TOKEN`: scoped to the production account, with Workers deployment,
  D1 migration, R2 binding, and production zone route permissions required by the
  Wrangler configurations. Include permission to manage Workers custom domains.
- `CLOUDFLARE_ACCOUNT_ID`: the account containing the Workers and D1 database.
- `CAMOX_DEPLOY_TOKEN`: the landing project's production deploy token, used by
  `camox release` to sync its definitions.

Do not require environment approval if deployment should be fully automatic.
Existing API runtime secrets must already be configured in Cloudflare; this
workflow does not provision or replace them. Disable any separate Cloudflare
Git-triggered builds for these apps to avoid competing deployments.

### Deployment order

1. Validate credentials; install with the frozen lockfile.
2. Build workspace packages, run checks and tests, build dashboard, dry-run the API bundle.
3. Apply pending production D1 migrations, then deploy the API.
4. Check `/health` (API availability and a D1 query).
5. Deploy dashboard, then run landing's `camox release` and deploy its Worker.

Landing's release builds and syncs against the newly deployed API, so it runs
after the API health check. It is not cached. A failed step stops subsequent
steps, but does not undo earlier deployments or production definition syncs.
The health check is a basic availability check, not full schema validation.

### Database changes

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

### Unpublished packages

Internal apps use `workspace:*` dependencies. The workflow builds SDK, CLI, UI,
and API contract from the deployed commit; no npm publication is necessary.
Public npm releases remain controlled by `.github/workflows/release.yml`.
The production API must still support older published SDKs used by customers.

GitHub does not normally trigger another workflow for commits pushed using its
`GITHUB_TOKEN`. If automation starts committing directly to `main`, use an
appropriate GitHub App token or explicitly dispatch deployment. Normal merges
of release PRs by a user trigger deployment like any other merge.
