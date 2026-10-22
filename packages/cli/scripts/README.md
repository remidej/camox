# The Template's copy

`apps/template-default` is the source of truth for the Template. Its copy leaves the monorepo through `src/lib/template.ts`:

- **`template-default` on Cloudflare Artifacts**, the read-only repo that new projects fork when they're created from the dashboard. `refresh-template-artifacts.mjs` copies the Template at the published SDK version, commits it with a `pnpm-lock.yaml`, checks that a fresh clone installs with `pnpm install --frozen-lockfile`, then pushes to `main`. When nothing changed, it pushes nothing.

The copy depends on the published `camox` instead of `workspace:*`, its `catalog:` ranges are replaced with the workspace catalog's, and the lines between `camox-cli:dev-only-start` and `camox-cli:dev-only-end` are dropped. The `camox-cli:replace-project-id` markers and the `{{projectName}}` placeholders stay in `template-default`, for whoever creates a project from it.

## Refreshing `template-default`

CI refreshes it after every SDK publish, in the `refresh-template` job of `.github/workflows/deploy.yml`. That workflow also publishes the SDK only once the API deploy of the same commit has succeeded, so no published SDK is ahead of the deployed API (ADR 0019).

To refresh it by hand, from the repository root:

```sh
CLOUDFLARE_ACCOUNT_ID=… CLOUDFLARE_API_TOKEN=… node packages/cli/scripts/refresh-template-artifacts.mjs
```

It uses `packages/sdk`'s version, which must be published; pass `--camox-version` for another. `--remote` pushes to any other Git remote instead, such as a local bare repo, which is what its test does (`test/network/refresh-template-artifacts.test.mjs`). That test installs from npm, so it stays out of `pnpm test`: run it with `pnpm --filter @camox/cli test:network`, as the deploy workflow does before changing production.

## Cloudflare setup

Replay it with:

```sh
pnpm --filter @camox/cli run setup:template-artifacts
```

The script needs the `cf` CLI signed in to Camox's account (`cf auth whoami`), `jq` and `git`. Each step checks what exists first, so it's safe to re-run. It does the following:

1. **The `projects` Cloudflare Artifacts namespace,** which holds `template-default` and every project's repo, since Cloudflare Artifacts forks within a namespace: `cf artifacts namespaces create --namespace projects`.
2. **The read-only `template-default` repo:** `cf artifacts namespaces repos create projects --name template-default --default-branch main --read-only`. Cloudflare Artifacts can't make an existing repo read-only, so the script stops if it finds one that isn't.
3. **A first refresh,** pushed with a write token that lasts an hour (`cf artifacts namespaces tokens create projects --repo template-default --scope write --ttl 3600`). Cloudflare Artifacts doesn't document what read-only blocks. If it refuses this push, read-only repos can't be refreshed, and `template-default` has to be created without `--read-only`.

## What CI needs

The `refresh-template` job runs in the `production` environment and reuses its secrets, `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`. It mints its own write token for each refresh, so there's no new secret, but the API token needs one more permission: **Account › Artifacts › Edit**. Add it to the token in the Cloudflare dashboard (_My Profile › API Tokens_), or the job fails on its first Cloudflare Artifacts call.
