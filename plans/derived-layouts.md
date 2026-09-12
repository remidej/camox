# Curated and derived layouts

Status: design decisions from the brainstorming discussion; not an implementation specification.

## Scope and direction

Extend the existing layout concept to support pages derived from application data. Do not introduce a separate "page template" concept.

Layouts have a discriminated `kind`:

- `curated`: wraps pages created individually in Camox, with their own blocks and URLs.
- `derived`: resolves pages using a route pattern and a server-side loader, rendering the same layout for each result.

Strong type safety is a priority. Breaking changes to the current layout API are acceptable.

[Collections](./collections.md) describes an independent Camox-managed ORM. Derived layouts can consume collections through ordinary loaders, just like any other application data source. The collections API itself remains outside this layout work.

## Loader and data access

Name the data function `loader`, not `lookup`. It may load a single record or return composed data such as `{ article, author, relatedArticles }`.

Loaders can import and call application database helpers, external integrations, or future Camox collections. The layout API does not require or inject a collection, and does not require external sources to implement a common collection interface.

Access the result through `Layout.useData()`, inferred from the awaited loader return type. Components do not receive inferred loader data as an `item` prop.

This follows the TanStack Router pattern: the returned definition exposes typed access to its loaded data. It also fits Camox's existing pattern of returning layout-specific helpers such as `BeforeBlocks` and `AfterBlocks`. It does not imply adopting TanStack Router as a dependency.

An earlier single-object proposal with inferred `item` props was sensitive to property order in a compiler experiment. The returned-object hook avoids that component-prop inference dependency. The exact production signatures still need type tests.

## File-based layout definitions and routing

Use the existing convention of one layout per file and extend the Vite plugin's code generation. Prefer this over a handwritten `route` string property.

The proposed shape is:

```tsx
// layouts/blog.$slug.tsx
export const Layout = createLayout("blog.$slug")({
  kind: "derived",
  loader: ({ params }) => articles.getBySlug(params.slug),
  component: ArticlePage,
});

function ArticlePage() {
  const article = Layout.useData();
  return <Article title={article.title} body={article.body} />;
}
```

The example assumes the data helper returns an article or signals not found; missing-data semantics are still to be finalized. Existing layout options are omitted for brevity. Exact filename syntax and identifier formatting are illustrative.

The plugin should:

- Generate boilerplate when a layout file is created.
- Maintain the file identifier in `createLayout(...)`, including after renames.
- Generate the type mapping from file identifiers to route patterns and parameter types.
- Register discovered layouts automatically.
- Detect equivalent derived route patterns, such as `blog.$slug` and `blog.$id`.

TypeScript cannot infer the current filename directly. The plugin-managed identifier connects the declaration to generated types. The first call selects the file identity and parameter types; the second infers the loader result.

For the example, the route is `/blog/:slug` and loader parameters are `{ slug: string }`. Unknown parameter names should be type errors. Runtime value validation and checking whether an article exists remain separate concerns.

A curated layout's filename identifies the layout only: its pages still choose their URLs in Camox. A derived layout's filename also defines its route pattern. File identity prevents duplicate layout names but does not, by itself, eliminate equivalent route patterns or collisions with database-authored URLs.

## Rendering and editing

Keep shared layout editing for both kinds, with page-specific composition available only on curated pages:

- `before` and `after` blocks are editable and shared across all pages of the layout, with purple overlays.
- Curated layouts retain `children` as the slot for page-specific authored blocks, with pink overlays. Their components can place or omit this slot as today.
- Derived layouts render loaded data alongside shared `before` and `after` blocks. They do not expose page-specific `children` or allow adding independently authored blocks for an individual derived URL in this phase.

Editing collection item fields is a future collection/block API concern. It should not be solved through the layout API in this phase.

Derived pages do not need backing Camox page records for custom blocks. Remove the proposed lazy page-record creation from this phase. Per-URL block identity, migration across slug changes, and independent block draft/publish state are deferred along with page-specific composition. Shared layout publishing and the source data's lifecycle remain separate concerns.

## SSR and deferred scope

Derived pages are resolved and server-rendered on request. Rendering does not require enumerating all possible URLs or a `getStaticPaths` equivalent.

Do not design listing/discovery in this phase, including sitemaps, derived-page browsing, and link-picker enumeration. These may eventually require an enumeration mechanism, but it is not a prerequisite for request-time rendering.

Also defer:

- Page-specific `children`, custom blocks, and their persistence on derived pages.
- The collections API and collection management UI.
- Collection-aware block fields, bindings, queries, and editing.
- A general external-source adapter API.

## Details to settle during implementation

- Missing-page signaling: `throw notFound()` was proposed, with source failures remaining errors rather than 404s; it was not explicitly finalized.
- Exact file naming, route syntax, generated declarations, and behavior while generated types are being refreshed.
- Collision policy between curated URLs and derived routes. Curated precedence was proposed, not explicitly finalized.
- Typed metadata/OG callbacks consuming loader data; hooks alone cannot serve these non-component callbacks.
- Server-only loader execution during client navigation, transport of loader results, and associated serialization constraints. Server-only execution was proposed; its implementation contract remains to be designed.

These details should preserve the agreed `curated | derived` model, file-based declarations, `loader`, and `Layout.useData()`. Shared blocks remain editable for both kinds; page-specific authored blocks remain exclusive to curated pages in this phase.
