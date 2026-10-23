# What code the agent may change

Camox's agent changes a hosted site's code for marketing teams with no developer, so whatever it writes nobody else will maintain or review as code. It may change any site-owned file under `src/`: blocks, layouts, the theme, components, the document, `src/lib` and collections. It never changes platform-owned files: `vite.config.ts`, `wrangler.jsonc`, `package.json`, the Worker entry and generated files, which only Upgrades change. It adds no npm dependencies and no binary assets, and its code makes no outbound requests on Live, so a draft's preview behaves like what publishing it serves ([What code the agent may change](https://github.com/remidej/camox/issues/518)).

## Considered Options

- **Only blocks, layouts and the theme.** The preview path compiles any changed module the same way, so narrowing would only push the agent to copy a component into a block to restyle it.
- **Config the agent may change, with a failed build as a blocker.** Nobody could maintain it, and it would fight every Upgrade.
- **New npm dependencies**, any through esm.sh or a curated list. Supply-chain risk on a live site nobody reviews; a curated list may come later.
- **Fonts as `@fontsource` packages**, or a font catalog Camox mirrors. The first is a dependency per font; the second is a catalog to run. Fonts come from Google Fonts instead, served from the site's own origin by [Cloudflare Fonts](https://developers.cloudflare.com/speed/optimization/content/fonts/), which falls back to Google's servers where it can't rewrite a page.
- **Outbound requests on Live**, freely or to hosts members allow. Previews block them (`globalOutbound: null`), so a block that fetches would preview broken and work on Live. Third-party scripts and APIs are for integrations Camox owns, later.

## Consequences

- Three layers keep the agent inside the line. Its write tools reject platform-owned paths. Type errors, failed builds and lint rules are blockers in agent-writable files, which is where import rules live. Editors review the preview, never the code.
- The shell built once per SDK version holds only npm dependencies, React and Camox. Components and layouts are per project, compiled like blocks.
- Cloudflare Fonts only rewrites `<link>` tags, so a font is a Google Fonts link in the document and a name in the theme's font tokens. The Template drops `@fontsource`. A lint rule allows the document no other external links or scripts.
- On Live, the dispatch namespace's outbound Worker blocks the project Worker's `fetch()`, as `globalOutbound: null` does in previews.
- Images and media are files, managed as content. An icon is inline SVG or from `lucide-react`.
- ADR 0007 stands: the agent may rename or remove fields and definitions, and content conforms on read. But the publish confirmation now lists the definitions and fields a draft removes while Live content uses them, since no developer meant the removal. It is a warning, not a blocker.
