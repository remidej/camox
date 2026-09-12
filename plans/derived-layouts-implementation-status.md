# Derived layouts implementation status

This is an initial implementation, not completion of `derived-layouts.md`.

Implemented:

- Curried file-identity API with `kind`, typed named loader parameters and awaited `useData()`.
- Existing single-object curated layouts remain compatible.
- Dot-separated file routes, `$name` parameters, curated-page precedence, equivalent-route detection, and static-route precedence.
- `throw notFound()`; other loader failures propagate.
- Request-time HTML rendering and JSON hydration without creating page records.
- Layout registration with either `Layout` or legacy `layout` exports.
- File boilerplate, identity updates, and generated route declarations in `src/layouts`.
- Playground Pokémon and Pokémon type pages, each with shared navbar and footer blocks.
- Standalone persisted layout reads: authenticated drafts, public live checkpoints, ordered block IDs, repeater markers and referenced files. Derived rendering uses the same normalized block caches and shared layout renderer as curated rendering; no page records are created.
- Shared studio preview shell for curated and derived pages: navbar, toolbar, responsive frame, shared-field overlays and inspector. Page metadata, page composition and block insertion controls remain curated-only. Derived preview source changes load the layout's own draft/live data.
- Browser-verified toolbar/viewport behavior on both Pokémon routes, shared-field selection, mobile rendering and anonymous localhost sign-in, without curated page-record queries or hydration errors.

Still required before calling the plan complete:

- Strip loaders and their server-only imports from client bundles. Loaders currently execute only on HTML requests, but their code remains bundled: **do not import secrets or server-only modules into these layouts yet**.
- Derived navigation data responses (currently navigation falls back to full document requests).
- Data-aware metadata/OG callbacks.
- Persist/sync the layout kind so derived layouts are excluded from curated-page creation UI and API choices.
- AST-based file updates rather than the initial literal-call text replacement, and broader generation tests.
- Full request, editing, publishing, hydration and client-bundle regression tests.

Manual checks performed against the playground dev server:

- `/pokemon/pikachu`: 200, SSR content and hydration payload present.
- `/pokemon-types/electric`: 200 with Pokémon links.
- `/pokemon/not-a-real-pokemon-camox`: 404.
