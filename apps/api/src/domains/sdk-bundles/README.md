# SDK Bundles

An SDK Bundle is Camox, React and the npm packages websites share with Camox, built ahead of time for the browser and for workerd (GLOSSARY.md, ADR 0029). The SDK names and builds it (`packages/sdk/src/features/sdkBundle/`). The API stores it, and ensuring one (`ensure.ts`) is the only step that ever does.

## Ensuring an SDK Bundle

`ensureSdkBundle(env, { packageJson, lockfile })` returns the bundle's names, one per target: `{ browser, workerd }`.

1. It names the bundle from the lockfile and the hosted settings (`HOSTED_SDK_BUNDLE_SETTINGS`), with the API's copy of camox (`camox/_internal/sdkBundleName`). When both targets are stored, it returns those names at once.
2. Otherwise it builds in a new release sandbox (`SANDBOX`, under a random name), which has run nothing and restores no snapshot. It writes only the manifest, without its `scripts`, and the lockfile, outside `/workspace`, then runs `pnpm install --frozen-lockfile --ignore-scripts`. No website code and no package's install script runs there.
3. The website's own camox builds the bundle (`camox/_internal/sdkBundle`) and reports the names it built under. They must be the API's names from step 1: otherwise it throws and stores nothing (see below).
4. Each target's folder is stored as one gzipped tar archive in `REVISION_BUILDS`, at `sdk/<name>.tar.gz`, with `onlyIf: { etagDoesNotMatch: "*" }`: only if nothing has that name yet. Callers that race all end up with the first stored bytes, and a bundle never changes once stored.

SDK Bundles are never deleted: a revision, a draft's Worker or Live can pin any of them.

### Which copy of camox names a bundle

The API's copy of camox names every stored bundle. The builder in the sandbox is the website's own camox, which a lockfile can point at a fork, so the names it prints aren't trusted: a fork could print another lockfile's name, such as the Template's next bundle, and the conditional write would keep its bytes there for everyone. So the bytes are stored only when the printed names are the API's own for that lockfile.

Every name digests `camox`'s own resolution in the lockfile, so a stored name was built by the website's camox version, and returning it at once is right.

**The API's camox must name bundles as the published SDK does.** Both digest `SDK_BUNDLE_BUILDER_VERSION` (`packages/sdk/src/features/sdkBundle/sdkBundleName.ts`) and what it covers. ADR 0019's order holds: the API that names bundles a new way is deployed before the SDK that builds them that way is published, and the Upgrade then moves every project to it. Between the two, a website still on the old naming has its ensure fail with `The website's camox built the SDK Bundle under other names than the API's copy of camox gives its lockfile (…)`, listing both pairs of names, and nothing is stored. Its revision or release fails as an infrastructure error, while bundles already stored keep serving. Its Upgrade fixes it.

## Who calls it

Each call is its own Workflow step (`ENSURE_SDK_BUNDLE`), as it installs and builds.

- **The Upgrade batch** (`../upgrades/workflow.ts`) ensures the Template's, from `template-default`'s `main`, before it upgrades any project, with `ifSwitchedOn`: once installed, the Template's camox is asked whether it builds against an SDK Bundle (`switch.ts`), and nothing is built when it builds whole-app. If it can't, the upgrade fails before moving anyone.
- **Each project's Upgrade** (`../upgrades/project-workflow.ts`) ensures its own after its update step and before its dry-run release, through `withStoredSdkBundle` (below), which asks the upgraded camox first. The upgraded lockfile is only in the update step's workspace snapshot, so a sandbox of its own restores that snapshot and reads the two files back. A bundle that can't be ensured fails the project's build step.

## Getting a stored bundle into a build

A hosted build never builds its bundle: it fails with the missing-bundle error (`sdkBundleMissingIn` reads it from the log) unless its cache (`CAMOX_INTERNAL_SDK_BUNDLE_CACHE`) holds a folder per target, named by the target's name. `fetchSdkBundle(env, sandbox, { cacheDir, lockfile, names?, ensureFrom? })` (`fetch.ts`) unpacks the stored archives into that cache, skipping a target already there. Without `names`, the API's copy of camox names the bundle. With `ensureFrom: { packageJson }`, a bundle that isn't stored is ensured first; without it, the call returns null.

- **Release steps** (`../releases/workflow.ts`, and an Upgrade's dry run in `../upgrades/project-workflow.ts`) build in `@cloudflare/ci` sandboxes, each on the workspace snapshot the previous step left. `withStoredSdkBundle(env, snapshot, source, buildEnv)` (`workspace.ts`), its own Workflow step, restores that snapshot in a sandbox of its own and asks the website's camox whether it builds against an SDK Bundle (`switch.ts`, which calls camox's `buildsAgainstSdkBundle`; a camox without it builds whole-app). If it does, it fetches the bundle into `/workspace/.camox-sdk-bundles` with `ensureFrom`, and backs the workspace up again. The cache must be in `/workspace`, the only folder a snapshot keeps, and the build step lays its commit's files over it, so a workspace that already holds that folder (committed, or made by the install) fails the step without retrying. The build step starts on that snapshot (`ci.runner({ snapshot })`, from the `@cloudflare/ci` patch in `patches/`), with `CAMOX_INTERNAL_SDK_BUNDLE_CACHE` naming the folder. The bundle comes from R2 only, never from the project's cached install.
- **A revision's sandbox** (`../revisions/sandbox.ts`) fetches it beside starting the revision builder, into `/opt/camox/sdk-bundles`, so a sandbox started ahead has it before its first build. A build that still fails with the missing-bundle error has it ensured, from the names in the error, and builds once more.

## Tests

`ensure.integration.test.ts` covers a stored bundle, a missing one, a race and a builder printing foreign names, `../revisions/sdk-bundle.integration.test.ts` covers revisions fetching and ensuring theirs, `../upgrades/workflow.integration.test.ts` covers both callers and the Upgrade's dry run, and `../releases/workflow.integration.test.ts` covers releases, with the release sandbox faked at its binding (`test/release-fakes.js`). The fake sandbox's build names the bundle from the lockfile written to it with the SDK's `sdkBundleName`, and archives a real gzipped tar whose `sdk-bundle.json` names the sandbox that built it. Its `camox release` fails without its bundle in its cache, as the website's camox does with the switch on. `test/sdk-bundles.ts` stores a bundle as ensuring does. `test/website-lockfile.ts` is a hosted website's lockfile, which names a bundle.

```sh
pnpm --filter @camox/api exec vp test --run --project integration src/domains/sdk-bundles src/domains/upgrades
```
