# Camox apps run on Cloudflare Workers

Camox apps used Nitro so they could deploy to any runtime. They now run only on Cloudflare Workers, through `@cloudflare/vite-plugin`, and Nitro is gone. Dev runs the server in workerd like production, so what works locally works deployed, and Camox can build on Workers-only features such as Dynamic Workers for changing blocks without a full build ([research](../research/previewing-code-changes-without-a-dev-server.md)). The Camox API and dashboard already run on Workers, so this is one platform instead of two.

## Considered Options

- **Keep Nitro.** Deploy-anywhere is worth little when Camox's own services run on Workers, and Nitro bundles everything into one Worker, which rules out a shell that loads blocks separately.
- **Nitro locally, Workers in production.** Dev would run in Node while production runs in workerd, so runtime differences would only show up after a deploy.

## Consequences

- An app adds `cloudflare()` to its Vite plugins and a `wrangler.jsonc` whose `main` is `camox/worker`. The Camox plugin refuses to start without the Cloudflare plugin. An app can write its own Worker that calls `camox/worker`'s `fetch` for the requests it doesn't answer.
- Camox builds the client before the Worker, the reverse of the Cloudflare plugin's order, because the Worker's build reads where each block's chunk ended up.
- Workers Static Assets serves the client build. The Worker never sees requests for files that exist.
- In dev, the Worker can't ask Vite to transform its HTML, so the Camox plugin computes what Vite would inject once and the Worker adds it to each page.
- The Worker's dependencies are pre-bundled in dev, starting from the same list as the browser's, so the first requests don't reload it one dependency at a time.
- OG images only use the WASM renderer for Workers. The Node variant is gone.
- `camox release` still only builds and syncs definitions. Deploying is `wrangler deploy`.
