# SDK Bundles

An SDK Bundle is Camox, React and the npm packages websites share with Camox, built ahead of time for the browser and for workerd (GLOSSARY.md, ADR 0029). The SDK names and builds it (`packages/sdk/src/features/sdkBundle/`). The API stores it, and ensuring one (`ensure.ts`) is the only step that ever does.

## Ensuring an SDK Bundle

`ensureSdkBundle(env, { packageJson, lockfile })` returns the bundle's names, one per target: `{ browser, workerd }`.

1. It names the bundle from the lockfile and the hosted settings (`HOSTED_SDK_BUNDLE_SETTINGS`), with the API's copy of camox (`camox/_internal/sdkBundleName`). When both targets are stored, it returns those names at once.
2. Otherwise it builds in a new release sandbox (`SANDBOX`, under a random name), which has run nothing and restores no snapshot. It writes only the manifest, without its `scripts`, and the lockfile, outside `/workspace`, then runs `pnpm install --frozen-lockfile --ignore-scripts`. No website code and no package's install script runs there.
3. The website's own camox builds the bundle (`camox/_internal/sdkBundle`) and reports the names it built under. Those are the names it stores under and returns.
4. Each target's folder is stored as one gzipped tar archive in `REVISION_BUILDS`, at `sdk/<name>.tar.gz`, with `onlyIf: { etagDoesNotMatch: "*" }`: only if nothing has that name yet. Callers that race all end up with the first stored bytes, and a bundle never changes once stored.

SDK Bundles are never deleted: a revision, a draft's Worker or Live can pin any of them.

### Which copy of camox names a bundle

Every name digests `camox`'s own resolution in the lockfile. So a stored name the API's copy computes was built by the website's camox version, and returning it at once is right. When the API's copy names a lockfile unlike the website's camox would, as when a later SDK changed what the name digests, the lookup misses: the sandbox builds, finds the website's camox's names, and stores nothing those names already hold. The API is deployed before every SDK publish, so it's never older than a website's camox.

## Who calls it

Each call is its own Workflow step (`ENSURE_SDK_BUNDLE`), as it installs and builds.

- **The Upgrade batch** (`../upgrades/workflow.ts`) ensures the Template's, from `template-default`'s `main`, before it upgrades any project. If it can't, the upgrade fails before moving anyone.
- **Each project's Upgrade** (`../upgrades/project-workflow.ts`) ensures its own after its update step and before its dry-run release. The upgraded lockfile is only in the update step's workspace snapshot, so a sandbox of its own restores that snapshot and reads the two files back. A bundle that can't be ensured fails the project's build step.

## Getting a stored bundle into a build

A hosted build never builds its bundle: it fails with the missing-bundle error (`sdkBundleMissingIn` reads it from the log) unless its cache (`CAMOX_INTERNAL_SDK_BUNDLE_CACHE`) holds a folder per target, named by the target's name. `fetchSdkBundle(env, sandbox, { cacheDir, lockfile, names?, ensureFrom? })` (`fetch.ts`) unpacks the stored archives into that cache, skipping a target already there. Without `names`, the API's copy of camox names the bundle. With `ensureFrom: { packageJson }`, a bundle that isn't stored is ensured first; without it, the call returns null.

- **A revision's sandbox** (`../revisions/sandbox.ts`) fetches it beside starting the revision builder, into `/opt/camox/sdk-bundles`, so a sandbox started ahead has it before its first build. A build that still fails with the missing-bundle error has it ensured, from the names in the error, and builds once more.

## Tests

`ensure.integration.test.ts` covers a stored bundle, a missing one and a race, `../revisions/sdk-bundle.integration.test.ts` covers revisions fetching and ensuring theirs, and `../upgrades/workflow.integration.test.ts` covers both callers, with the release sandbox faked at its binding (`test/release-fakes.js`). The fake sandbox's build names the bundle from the lockfile written to it with the SDK's `sdkBundleName`, and archives text naming the sandbox that built it. `test/website-lockfile.ts` is a hosted website's lockfile, which names a bundle.

```sh
pnpm --filter @camox/api exec vp test --run --project integration src/domains/sdk-bundles src/domains/upgrades
```
