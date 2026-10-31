# Nx cache Worker

Nx's remote task cache, at `https://nx-cache.camox.ai`. Nx's built-in HTTP cache client talks to it when `NX_SELF_HOSTED_REMOTE_CACHE_SERVER` is set, following Nx's [self-hosted cache spec](https://nx.dev/docs/guides/tasks--caching/self-hosted-caching): `GET` and `PUT /v1/cache/<hash>`, with the bearer token from `NX_SELF_HOSTED_REMOTE_CACHE_ACCESS_TOKEN`. Each entry is the tarball of a task's outputs that Nx sends, stored as is in the `camox-nx-cache` R2 bucket under its hash. The first entry stored for a hash stands: a later `PUT` gets 409, which Nx reads as "already stored".

CI and local runs share one read-write token, so a task that passed on a machine is a hit in CI, and the other way round. Worktrees of one checkout already share their local cache (the main checkout's `.nx/cache`), so this mostly helps between CI and machines.

```sh
pnpm --filter @camox/nx-cache test        # Nx's own client against the Worker, with a fake bucket
pnpm --filter @camox/nx-cache run deploy  # also creates the nx-cache.camox.ai Custom Domain
```

It isn't deployed with releases: deploy it by hand when it changes.

## Setup

- **The bucket:** `cf r2 buckets create-by-name camox-nx-cache`, with a lifecycle rule deleting entries 30 days after upload, so it doesn't grow without bound:

  ```sh
  cf r2 buckets lifecycle update camox-nx-cache --rules '[{"id":"expire-after-30-days","enabled":true,"conditions":{"prefix":""},"deleteObjectsTransition":{"condition":{"type":"Age","maxAge":2592000}}}]'
  ```

- **The token:** the Worker's `ACCESS_TOKEN` secret (`wrangler secret put ACCESS_TOKEN`), the repo's `NX_SELF_HOSTED_REMOTE_CACHE_ACCESS_TOKEN` Actions secret, which `.github/workflows/deploy.yml` passes to Nx, and the same variable on each machine, beside the server's:

  ```sh
  export NX_SELF_HOSTED_REMOTE_CACHE_SERVER=https://nx-cache.camox.ai
  export NX_SELF_HOSTED_REMOTE_CACHE_ACCESS_TOKEN=<token>
  ```

  To rotate it, set a new token in all three places.

Without the variables, Nx runs with its local cache only.
