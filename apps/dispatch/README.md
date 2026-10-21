# Dispatch Worker

Serves each project's website at `<slug>.camox.site`. The Worker reads the slug from the hostname's first label, looks up the project's UUID in the `camox-project-slugs` KV namespace, and forwards the request to the user Worker named after that UUID in the `production` Workers for Platforms dispatch namespace.

Naming user Workers after the project's UUID depends on #436: projects still have integer ids today, and #436, with its amendment to ADR 0004, gives them a UUID.

- A known slug whose user Worker isn't deployed yet gets a "This site is being set up" page (503).
- An unknown slug, a deeper subdomain, or the bare domain gets a not-found page (404).

```sh
pnpm --filter @camox/dispatch test        # routing tests, with a fake KV map and namespace
pnpm --filter @camox/dispatch run deploy  # also creates the *.camox.site/* route
```

CI deploys it from `main` with the rest of Camox (`.github/workflows/deploy.yml`).

## Cloudflare setup

Replay it with:

```sh
pnpm --filter @camox/dispatch run setup:cloudflare
```

The script needs the `cf` CLI signed in to Camox's account (`cf auth whoami`) and `jq`. Each step checks what exists first, so it's safe to re-run. It does the following:

1. **Workers for Platforms subscription.** This is the one manual step, and `cf` can't do it: subscribing through the API answers 403 with error 10121, which points to the dashboard. Subscribe there at <https://dash.cloudflare.com/?to=/:account/workers-for-platforms>. Until you do, the API answers dispatch namespace calls with the same error, and the script stops there.
2. **The `production` dispatch namespace:** `cf workers-for-platforms dispatch-namespaces create --name production`.
3. **The `camox-project-slugs` KV namespace:** `cf kv namespaces create --title camox-project-slugs`. Its id must match the `PROJECT_SLUGS` binding in `wrangler.jsonc` (`0f6abd3321cf43938cf0f9a59b2c555f`).
4. **A proxied wildcard DNS record** on the `camox.site` zone: `AAAA *.camox.site 100::`, proxied. `100::` is a discard address. The record only exists so that Cloudflare's proxy answers every subdomain, and the route then sends the requests to the Worker. Universal SSL covers first-level subdomains, which is why slugs are one label deep.
5. **The Worker and its `*.camox.site/*` route:** `wrangler deploy` creates the route from `wrangler.jsonc`.

## Smoke-testing a website by hand

Deploy the Template as a user Worker into `production`, then point a slug at it. Use any UUID and an unused slug, here `smoke`:

```sh
KV_ID=0f6abd3321cf43938cf0f9a59b2c555f # camox-project-slugs
UUID=$(uuidgen | tr 'A-Z' 'a-z')

# Build the Template against production while signed in to it (`camox login`).
pnpm nx run-many -t build --projects=tag:type:pkg
VITE_API_URL=https://api.camox.dev VITE_DASHBOARD_URL=https://app.camox.dev \
  pnpm --filter @camox/template-default build
pnpm --filter @camox/template-default exec wrangler deploy --dispatch-namespace production --name "$UUID"

# Before this entry exists, smoke.camox.site gets the not-found page.
# Once it exists, the Template answers.
cf kv keys update smoke --namespace-id "$KV_ID" --body "$UUID"
curl https://smoke.camox.site/_camox/health   # → ok
```

The health check answers without the API, so it shows that dispatch works even if the Template's project doesn't exist in production. To check the "being set up" page, point a slug at a UUID with no user Worker. To clean up:

```sh
cf kv keys delete smoke --namespace-id "$KV_ID" --force
cf workers-for-platforms dispatch-namespaces scripts delete "$UUID" --dispatch-namespace production --force
```

Without `--force`, both commands ask for confirmation, so they abort when run non-interactively.
