# Public renders are cached under a Live cache key

A website's public renders (pages, their Markdown Representation and navigation data, llms.txt, the sitemap, OG images, the logo) are kept in the Cache API of the data center serving them, keyed by the URL, the representation, the website's build and the project's Live cache key. The key is a random token the API mints and serves through Workers Caching, so it costs the site one edge-cached subrequest per request. Every unit of work that changes Live (a publish, a release syncing definitions, a Generated Value on Live, a Project Setting) purges it by tag through `ctx.cache.purge`, which reaches every data center at once. The next request then gets a new key, and every render cached under the old one is left behind. A release builds a new build ID, so new code never serves HTML that names the last release's assets. Private renders (a session, a draft named in the URL, a preview handoff, dev mode) are never looked up or stored, and a response marked `private`/`no-store` or setting a cookie is never stored. The API's files and favicons go through the same Workers Caching entrypoint, purged by tag when a blob is deleted or a favicon changes.

## Considered Options

- **Short TTLs or stale-while-revalidate.** Simple, but a publish wouldn't show at once, which is what editors expect.
- **`caches.default.delete` on publish.** It only clears the data center it runs in.
- **Zone purge by tag or URL from the API.** It needs an API token per zone, and self-hosted websites run on zones Camox may not own. Purging by URL isn't documented to reach Cache API entries either. camox.ai and camox.site are both on the Free plan, so a purge by tag gets no more headroom than Workers Caching's own.
- **Workers Caching in front of each website, purged by the website itself.** No subrequest per hit, but the API would have to reach every website's own purge endpoint, authenticated, and know each one's URLs. Each website would also need `exports` config in its `wrangler.jsonc`, and the cache keys ignore cookies, so members would need a gateway entrypoint in front.
- **A Live version counter in D1.** A counter the edge keeps past a purge still names older renders. A key minted on a miss names none of them.
- **KV for the key.** Its writes take up to a minute to show everywhere.

## Consequences

- Workers Caching purges always count against Free plan limits: a burst of 25, then 5 a minute, for the whole account. One `EdgeCachePurger` Durable Object batches every purge (up to 100 tags) and spaces them 12 seconds apart. When the account is idle, a publish shows at once. Under load it takes up to about 12 seconds.
- The key expires after a day as a backstop, so a lost purge can't keep a website stale for longer.
- Deploying the API starts a new Workers Caching version, so every website renders each page once again.
- When the key can't be read, the website renders uncached. A website deployed before the API answers keys just doesn't cache.
- Visitors' browsers get `public, max-age=0, must-revalidate`, since they can't be purged.
