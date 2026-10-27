# Code-driven visuals are artifacts: sandboxed web pages stored as content

Bespoke visuals and interactions, such as SVG animations, 3D scenes, and small interactive widgets, are stored as artifact fields. An artifact holds a self-contained web page as content (its artifact source), usually written by an agent, and renders in an iframe with `sandbox="allow-scripts"` and no `allow-same-origin`. That gives the page an opaque origin, so it can run any code but can't reach the website, the studio, or their sessions. Before this, the only option was a one-off block definition per visual. That kept code in code, but turned single-use visuals into reusable "building blocks", with settings bolted on to make them look adaptable. It also meant a release for every tweak. Storing the page as content keeps block definitions for real building blocks, and lets agents create and iterate on visuals the same way they edit any other content.

## Considered Options

- **One-off blocks.** The status quo. Type-checked and reviewed, but bespoke visuals end up as definitions that only fit one use, and every change needs a release.
- **Uploaded video.** No interactivity, no theming, heavy files, and poor quality on high-density screens.
- **A Camox scene format on top of one animation library.** A large surface for us to own, and still unable to express everything a page of code can.
- **Raw HTML injected into the page.** Same-origin scripts could read the studio session, so any content edit would be a stored XSS.

## Consequences

- Anyone who can edit content can run arbitrary JavaScript for website visitors, though only inside the sandbox. Editors are trusted for now.
- Artifacts can't see the page they're in. Scroll position, theme, artifact data, and studio state reach them through a small `camox` runtime that the SDK injects into every artifact source. While Camox is pre-1.0, that runtime's API comes with no stability guarantee, even though stored sources depend on it.
- Artifact sources are opaque to Camox. Their Markdown Representation is their `<title>`, and they are kept out of AI summaries and SEO generation.
- Sources are inlined with `srcdoc`, so artifacts paint without another request, but every frame carries its own copy of the minified runtime and nothing is cached across pages. Public pages leave the sources their frames hold out of the hydration data, so each ships once. Moving to hosted, hash-addressed URLs later doesn't change stored content.

## Amendment: public pages load artifacts by URL

Inlined `srcdoc` frames can't be lazy-loaded, so every artifact on a public page booted while the page was loading, competing with it for the network and the main thread, and nothing was cached across visits. Public renders now point each frame at `/_camox/artifacts/<shellHash>/<sourceHash>`, which the website's own Worker serves, so artifacts load as visitors approach them and are cached for a year. The studio, drafts and preview links keep `srcdoc`, so an agent's change still shows at once.

- The API stores every artifact source it writes in a per-project, content-addressed store, in the same transaction as the content, and returns each source's hash with its content reads. Old sources are kept: the store is derived data, not Live's history (ADR 0008), and a page cached before a publish still loads exactly the artifacts it showed.
- The shell hash covers the runtime and the website's font links, so a release that changes neither keeps every artifact cached.
- The starting Artifact Data travels in the URL's fragment, written by the page's render. The document holds only the runtime, the font links and the source, so one cached document serves every placement, locale and page that uses it.
- The Worker serves each document with `Content-Security-Policy: sandbox allow-scripts`, so it keeps an opaque origin even when opened outside its frame, and with `X-Robots-Tag: noindex`.
- Public hydration data carries no artifact sources at all, only their hashes.

### Considered Options

- **URLs naming the artifact's identity** (locale, block, item, field) with the hash as a cache buster. No new store, but every edge case (localizations sharing ids, synced blocks placed on many pages, a publish racing a cached page, deleted artifacts) became part of the URL or the Worker's lookup.
- **Serving artifacts from the Camox API or a separate sandbox domain.** Visitors would open another connection, and self-hosted websites would need a second domain.
- **Keeping `srcdoc` but setting it as frames near the viewport.** Lazy, but the sources still ship in every page and nothing is cached.
