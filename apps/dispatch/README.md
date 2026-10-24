# Dispatch Worker

Serves each project's website at `<slug>.camox.site`. The Worker reads the slug from the hostname's first label, looks up the project's UUID in the `camox-project-slugs` KV namespace, and forwards the request to the project's user Worker in the `production` Workers for Platforms dispatch namespace: the one named after that UUID, which its releases deploy, or the one a publish with code uploaded, until the next release (`apps/api/src/domains/publishes/README.md`). Dispatch asks the API's `CamoxPreviews` entrypoint which (`liveScript`, `src/live-script.ts`), over its `API` service binding, and keeps each project's answer for `LIVE_SCRIPT_TTL_MS` (2 seconds) in the isolate, so a publish's promotion or rollback reaches every request within that. A public request asks at most once per isolate and project in that time, a primary D1 read. While the API can't answer, the last answer stands, or the Worker named after the UUID when there was none. A publish's Worker that's gone (deleted since the answer) falls back to the one named after the UUID too.

- A known slug whose user Worker isn't deployed yet gets a "This site is being set up" page (503).
- An unknown slug, a deeper subdomain, or the bare domain gets a not-found page (404).

It also loads drafts' revisions as Dynamic Workers (`src/revisions.ts`), from their builds in the `camox-revision-builds` R2 bucket, through its Worker Loader binding. Each runs under its asset prefix `/_camox/r/<revisionId>/`, and its outbound requests go through the `CamoxGateway` entrypoint: requests to the Camox API (`CAMOX_API_URL`) are sent in the revision's draft, and every other request goes out as it was sent. The API reads a revision's Definition Set and prewarms it through the `CamoxRevisions` entrypoint, over its `DISPATCH` service binding, so dispatch deploys before the API. Prewarming stores the revision's client assets in the same bucket (`<project>/revisions/<revisionId>/…`), which dispatch serves at `/_camox/r/<revisionId>/*` on its project's host, to anyone.

A draft with code's renderer document and runtime reads (`/_camox/renderer`, `/_camox/data`, `/_camox/routes`, naming the draft with `?camox-draft=`) go to the draft's previewed revision when the request's session can see the draft (`src/previews.ts`). Dispatch asks the API's `CamoxPreviews` entrypoint, over its `API` service binding, and keeps the answer for `PREVIEW_ANSWER_TTL_MS`, except for renderer documents, which always ask. Every other request, and any request the API doesn't answer, reaches the project's user Worker.

```sh
pnpm --filter @camox/dispatch test        # routing and revision tests, with fake bindings
pnpm --filter @camox/dispatch run deploy  # also creates the *.camox.site/* route
```

CI deploys it with the rest of Camox on each release (`.github/workflows/deploy.yml`).

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
VITE_API_URL=https://api.camox.ai VITE_DASHBOARD_URL=https://app.camox.ai \
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
