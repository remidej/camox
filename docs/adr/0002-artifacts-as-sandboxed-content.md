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
