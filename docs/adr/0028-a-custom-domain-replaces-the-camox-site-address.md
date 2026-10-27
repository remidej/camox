# A Custom Domain replaces a project's camox.site address

A website builds its canonical URLs, sitemap, hreflang links and structured data from the host a request came in on. Serving one at both a Custom Domain and its `camox.site` subdomain would publish two copies of it. So a project has at most one Custom Domain, and once it has one, dispatch serves it there and redirects every request for the `camox.site` subdomain to it with a 301. The studio works on the Custom Domain too, so editors work at the address they publish to. Operators set Custom Domains for now, starting with camox.ai.

## Considered Options

- **Serve both hosts, with canonical links naming the Custom Domain.** Every absolute URL the SDK writes would have to come from the project's address instead of the request.
- **Keep the studio on `camox.site` and redirect only visitors.** Dispatch would have to tell members from visitors before redirecting, and editors would work at a different address from the one they publish to.

## Consequences

- Dispatch maps a Custom Domain to its project through KV, next to the slugs.
- Studio sign-in mints tokens for a project's Custom Domain as it does for its subdomain.
- Website hosts accept only studio sessions. They used to fall back to the native session cookie, which on camox.ai is the dashboard's, set for every `camox.ai` host.
- The dashboard's link to the website and the API's generated OG image URL use the Custom Domain.
- Members can't add a Custom Domain yet: that needs domain verification and Cloudflare for SaaS.
