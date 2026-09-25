# Collections — v1 specification

## Status and intent

This document records the collections design agreed during brainstorming. It is a specification, not documentation of shipped APIs. Examples describe the target SDK; implementation details that were not settled are listed separately.

Collections let site editors manage schema-defined records once and reuse their content across different blocks and pages. They are native Camox content, with type-safe schemas, inline preview editing, and independent publication.

Primary use cases:

- A customer appears in a logo grid, a testimonial, and a customer/use-case page.
- An article appears on its own derived page, an articles index singleton page, and an article-list or recent-articles block.

## Scope

### Included

- `createCollection`, following the existing `createBlock` / `createLayout` conventions.
- Required, type-safe record labels.
- Collection-management UI for creating and editing records.
- Single references, ordered reference lists, and query-backed reference lists.
- References in block content, repeater content, and collection schemas.
- Collection fields editable directly in preview, regardless of where they render.
- Independent item publication, purple preview overlays, and publication-modal switches.
- Collection-backed derived layouts through ordinary loader functions.
- A consistent loader-result envelope and a separate, optional route-discovery function.
- A collection helper that supplies both loading and route discovery.
- Per-use Markdown for referenced content and layout-owned Markdown for code-owned pages.
- Runtime validation and server-enforced site/environment boundaries.

### Explicitly out of scope

- A public ORM, database connection, or SDK CRUD API.
- New block loaders for this feature; blocks use declarative references and queries.
- Collection-level `toMarkdown`.
- AI summaries as record labels.
- Item-owned block trees. Per-page blocks in derived layouts are a larger, separate feature.
- Implicit local overrides of shared collection fields.
- An editor-facing query builder.
- Expanded schema primitives and their broader design: dates, numbers, slug types, uniqueness configuration, draft-validation APIs, and schema migration APIs.
- Integrating generated destinations into existing link fields and inline text links, including the broader slug-redirect and canonical-destination design.

Deferring schema and link work does not remove existing validation/security requirements. It also does not remove route discovery from scope: enumeration is included; the link-editor integration is not.

## Ownership model

| Concept           | Ownership                                                                  |
| ----------------- | -------------------------------------------------------------------------- |
| Collection record | Independently identified, reusable content                                 |
| Block             | Presentation, local content/settings, and selected references              |
| Repeater item     | Content/settings owned by its parent, including local reference placements |
| Synced block      | Shared content/settings for a block type                                   |
| Layout            | Route pattern, page presentation, and existing layout-owned blocks         |

References store record identities, not copies of the referenced content. Editing a record through a testimonial changes the same draft record used by the logo grid. Changing a block's reference changes only that selection.

Per-placement presentation belongs to the placement, not the record. For example, an emphasized logo can be a repeater item containing a customer reference plus a local setting.

Deleting a placement or removing a reference must not delete the collection record.

## Collection definitions

Reuse the existing `content` schema vocabulary rather than introducing a second schema language.

```tsx
import { createCollection, Type } from "camox/createCollection";

export const customers = createCollection({
  id: "customers",
  title: "Customers",
  description: "Customers featured in testimonials and case studies.",

  content: {
    name: Type.String({ default: "New customer" }),
    logo: Type.Image(),
    quote: Type.String({ default: "" }),
    spokesperson: Type.String({ default: "" }),
  },

  label: "name",
});
```

- `id` is the stable collection definition identity.
- `title` is its editor-facing title.
- `description` explains the collection's purpose to editors and agents, following existing definition conventions.
- `content` is the source of truth for types, runtime validation, and field editors.
- `label` is required and selects a suitable text field from `content`. Unknown keys and non-text fields are type errors.
- The selected label is used in collection rows, reference pickers, and editor breadcrumbs. It is not a record ID or route key.
- System record identity and lifecycle metadata remain separate from authored `content`.
- A collection has no default component and no `toMarkdown`. The same content can have multiple presentations.

Register collections alongside existing definitions:

```tsx
createApp({
  collections: [customers, articles],
  blocks: [testimonial, logoGrid, articleList],
  layouts: [articleLayout, articlesIndex],
});
```

Collection definitions must be available to the runtime/editor and synchronized with the API for schema validation. Record operations remain scoped to the current site and environment.

## References in content schemas

### Single reference

```tsx
const testimonial = createBlock({
  id: "testimonial",
  title: "Testimonial",
  description: "A quote from a selected customer.",

  content: {
    customer: Type.Reference(customers),
  },

  settings: {
    showLogo: Type.Boolean({ default: true }),
  },

  component: Testimonial,

  toMarkdown: (c) => [`> ${c.customer.quote}`, `— ${c.customer.spokesperson}, ${c.customer.name}`],
});

function Testimonial() {
  return (
    <testimonial.Reference name="customer">
      {(customer) => (
        <figure>
          <customer.Field name="quote">{(props) => <blockquote {...props} />}</customer.Field>

          <customer.Field name="name">{(props) => <figcaption {...props} />}</customer.Field>
        </figure>
      )}
    </testimonial.Reference>
  );
}
```

- The reference picker selects an existing record and supports creating a record.
- The rendering callback receives a typed scope bound to the resolved record.
- `customer.Field`, `customer.Image`, and other supported primitives follow existing Camox field conventions and restrict names to compatible fields.
- An unset reference shows an editor placeholder. The callback runs only with a resolved record, not a fabricated default customer.
- Selecting the customer is authored content, even though the selection control lives in the sidebar. Presentation toggles remain settings.
- Scoped callback names use camelCase, matching the existing repeater style.

### Manually selected list

Use `ReferenceList`, matching `ImageList`, on both the schema and rendering sides.

```tsx
// Inside a block definition:
content: {
  customers: Type.ReferenceList(customers, {
    maxItems: 24,
    toMarkdown: (customer) => [customer.name],
  }),
},

toMarkdown: (c) => [
  "## Our customers",
  c.customers,
],
```

```tsx
<logoGrid.ReferenceList name="customers">
  {(customer) => <customer.Image name="logo">{(props) => <img {...props} />}</customer.Image>}
</logoGrid.ReferenceList>
```

Editors can select, remove, and reorder references. Ordering belongs to the list placement. An empty selection is valid; no records are automatically created to populate a block preview.

### Query-backed list

The same field and rendering component support developer-defined queries:

```tsx
content: {
  articles: Type.ReferenceList(articles, {
    query: {
      orderBy: { title: "asc" },
      limit: 3,
    },
    toMarkdown: (article) => [
      `## ${article.title}`,
      article.excerpt,
    ],
  }),
},
```

- Query keys and supported operators must be typed against the collection.
- Camox owns fetching, server rendering, publication filtering, and preview updates.
- Record fields remain editable through the same scoped primitives.
- Query membership and ordering are not manually editable selections. The editor must not offer drag-to-reorder or removal controls that contradict the query.
- Manual lists store ordered references. Query results are resolved content, not block-owned copied items.
- The exact query operator set and ordering on system metadata remain to be specified. New date/number field APIs are not introduced by this document.

This is the declarative integration for list/index/recent-content use cases; no public ORM or block loader is required.

### References inside collections and repeaters

The same `Type.Reference` and `Type.ReferenceList` types work in collection schemas, for example an article referencing an author. They also work in repeater content for local placement settings.

There is no second relationship API. Resolution must be bounded and must not recursively expand cyclic relationships without a limit. Detailed expansion/depth policy remains an implementation decision.

Rendering-specific options such as per-item Markdown belong to the consuming presentation. A reference declared in a collection does not acquire a universal presentation of its target.

## Preview editing and publication

### Editing

- Collection-backed field overlays are purple, using the shared-content convention established by synced blocks.
- The overlay/breadcrumb identifies the source record using its label.
- An edit changes the source record's draft, not the referencing block.
- Every visible occurrence of that record updates in preview, including occurrences in different block types and in the derived layout.
- A field's mutation target and its rendered occurrence are distinct: the same source field may have multiple overlays.
- Ordinary external loader data does not become editable just because it resembles a record.
- Authorization, collection ownership, and environment checks are enforced on the server, not inferred from a client-supplied ID.

### Publication

Collection items publish independently, following the shared-content behavior of synced blocks.

- Public reads resolve the latest published item revision.
- Authorized preview reads resolve draft content.
- Editing a draft does not alter live content.
- Publishing an item updates its live uses without requiring every containing page to be republished.
- Collection items appear as independently selectable targets in the publication modal, using switches like synced blocks.
- The same item encountered through multiple placements must not appear as multiple publication targets.
- Publishing a page or layout must not silently publish unselected collection drafts.
- Publication must refresh affected live references, query membership, derived-page data, and route enumeration. Draft edits refresh preview dependencies instead.

Historical reads must not silently substitute today's shared data for historical content. Exact checkpoint representation, restoration behavior, modal switch defaults, and handling of unpublished required dependencies remain open details; follow existing shared-content conventions rather than inventing a separate lifecycle.

## Layout loading

### One ordinary-function contract

Loaders remain ordinary functions. This is a breaking change to their return contract: every successful result uses an explicit envelope with `data`.

An external/custom loader returns:

```tsx
loader: async ({ params }) => ({
  kind: "data",
  data: await fetchArticle(params.slug),
}),
```

A collection-item loader returns a serializable envelope:

```tsx
{
  kind: "collection-item",
  collectionId: "articles",
  data: {
    id: "article_123",
    content: {
      title: "Introducing collections",
      slug: "introducing-collections",
      excerpt: "Reusable, editable content.",
      body: "...",
    },
  },
}
```

- `layout.useData()` consistently returns the unwrapped `data`.
- `createLayout` infers the full result type, not just an unclassified object.
- Collection-item results enable a typed `layout.Item` scope.
- External/custom data results retain ordinary `useData()` behavior without a collection-bound `Item`.
- At runtime, `collectionId` selects the registered schema and `data.id` identifies the mutation target.
- Collection/schema associations must be validated; an envelope is not authorization.
- No React components or functions travel in the result.
- No properties or symbols are attached to the loader function.
- A collection lookup that does not resolve a record throws `notFound()`.
- Wrapping a loader in another ordinary function preserves the binding when the wrapper returns its envelope.

The initial helper binds a layout to one collection. Supporting heterogeneous collection-result unions is not required by the agreed examples; its type behavior remains an open detail.

## Route discovery

`routes` is an optional sibling of `loader`, not a loader phase and not metadata attached to a function.

- `loader` resolves content for one requested URL.
- `routes` enumerates parameter sets for the layout's known route pattern.
- Both return `{ data, ... }` envelopes.
- `routes` has one result shape and needs no `kind` discriminator.
- Omitting `routes` does not prevent the loader from serving valid URLs. It means Camox cannot enumerate them.

External data supports the same contract:

```tsx
export const layout = createLayout("articles.$slug")({
  // Other existing layout options omitted.
  kind: "derived",

  loader: async ({ params }) => ({
    kind: "data",
    data: await fetchArticle(params.slug),
  }),

  routes: async () => {
    const records = await fetchArticles();

    return {
      data: records.map((article) => ({
        params: { slug: article.slug },
      })),
    };
  },

  component: ArticlePage,
});
```

Parameter names are checked against the route pattern. Return parameter values rather than manually building URL strings; Camox handles path construction/encoding.

A collection-backed entry additionally carries an optional target:

```tsx
{
  params: { slug: "introducing-collections" },
  target: {
    kind: "collection-item",
    collectionId: "articles",
    id: "article_123",
  },
}
```

The enclosing layout provides layout identity. The target preserves record identity independently of its current route parameter; actual integration into stored links and pickers is deferred.

Further rules:

- An empty collection returns `{ data: [] }` without needing a valid example slug.
- Public discovery enumerates published records only.
- Collection loading and discovery use consistent lookup, filtering, and visibility rules.
- Discovery is not an authorization check or a substitute for the loader validating a request.
- Large result sets must support pagination rather than requiring every record in one response. `nextCursor` is the proposed envelope field; exact cursor input and termination semantics remain to be specified.
- Sitemap enumeration can consume this contract without putting discovery branches into custom loaders.

## Collection page helper

`articles.pages()` generates both ordinary functions from one configuration:

```tsx
const articlePages = articles.pages({
  by: "slug",
  param: "slug",
});

export const layout = createLayout("articles.$slug")({
  // Other existing layout options omitted.
  kind: "derived",
  loader: articlePages.loader,
  routes: articlePages.routes,
  component: ArticlePage,
});
```

The concise form is equivalent:

```tsx
export const layout = createLayout("articles.$slug")({
  // Other existing layout options omitted.
  kind: "derived",

  ...articles.pages({
    by: "slug",
    param: "slug",
  }),

  component: ArticlePage,
});
```

- The helper returns an ordinary `{ loader, routes }` object.
- `by` selects the collection lookup field; `param` selects the route parameter.
- The lookup must resolve unambiguously and use a route-compatible field. The broader schema API for declaring uniqueness and specialized slug fields is deferred; do not invent that API as part of this spec.
- The helper shares configuration between lookup and enumeration and handles publication visibility and not-found behavior.
- It does not create an independently authored page row or a per-record block tree.
- Routes belong to layouts, not to the collection definition. A collection can be rendered without a route or used by more than one layout.
- There is no separate layout `source` option, declarative-loader alternative, or discovery invocation mode.

### Editable item layout

Use camelCase for the layout definition and scoped item:

```tsx
function ArticlePage() {
  return (
    <>
      <layout.BeforeBlocks />

      <layout.Item>
        {(article) => (
          <main>
            <article.Field name="title">{(props) => <h1 {...props} />}</article.Field>

            <article.Field name="body">{(props) => <div {...props} />}</article.Field>
          </main>
        )}
      </layout.Item>

      <layout.AfterBlocks />
    </>
  );
}
```

The definition establishes the collection through the loader's result type; runtime data establishes the current record. Developers do not manually wire `<articles.Item value={article}>`.

An articles index can remain a singleton layout containing a query-backed article-list block. Individual article pages remain derived layouts. Existing shared before/after layout blocks are unchanged.

## Markdown ownership

The presentation owns its Markdown output:

- A block formats the collection fields it renders.
- A single reference supports typed field access such as `c.customer.quote` in the block's builder.
- A reference list supports a per-use `toMarkdown` option, following the repeater convention. The parent block includes the resulting list through its content token.
- A layout rendering loaded content directly owns that content's Markdown. This applies to external and collection data alike.
- A collection definition has no Markdown renderer, and record rendering never implicitly invokes one.

Layout-owned Markdown is an agreed requirement. The following callback signature is proposed rather than already implemented:

```tsx
toMarkdown: ({ data }) => [
  `# ${data.content.title}`,
  data.content.excerpt,
  data.content.body,
],
```

The callback receives unwrapped, typed loader data. Markdown responses must use the same publication visibility as the corresponding rendered page.

Before/after layout blocks retain their own Markdown. The exact assembly contract for combining their output with the layout body must be finalized; do not omit or duplicate layout chrome accidentally.

Existing metadata callbacks should be reviewed for access to loader data so collection pages can have item-specific metadata. This does not introduce a separate collection SEO API; the exact callback changes are not settled here.

## Implementation boundaries and integration

- Reuse field editing primitives with an explicit record source, rather than copying collection content into block-owned repeater rows.
- Keep reference identity separate from resolved content and rendered occurrence identity.
- Resolve assets in collection fields through the existing asset system. Collection content must participate in relevant asset usage and invalidation paths.
- Use the same schemas and validated operations for editor and AI-tool authoring. No public ORM does not mean records are inaccessible to Camox agents.
- Account for references and query dependencies when refreshing preview/public content.
- Do not reuse physical block-placement counts as proof that a collection record has no references.
- Existing loader consumers, SSR/navigation responses, and hydration must migrate consistently to envelopes. Do not leave different interpretations of `data` across runtime paths.
- Examples are target API sketches, not executable examples against the current SDK.

## Remaining decisions

These are not permission to expand v1 into the explicitly deferred features:

1. Exact publication-modal switch defaults and dependency behavior when selected content references unpublished items.
2. Checkpoint representation and historical/restore semantics for referenced record revisions.
3. Delete/unpublish policy for referenced items, including references held by other collections and published snapshots.
4. Query operator set, system-metadata ordering, and relation-resolution depth/cycle handling.
5. Route-discovery pagination details and route-collision behavior relative to existing curated pages.
6. Per-use nested reference Markdown behavior and final layout Markdown/metadata callback signatures.
7. How reference field empty/optional states and collection schemas reuse existing field primitives without inheriting inappropriate block-preview/rendering requirements.
8. Runtime/type behavior if a custom loader returns different kinds or different collections across branches.

## Acceptance criteria

- A customer record can be selected in a testimonial and logo grid without duplicating its content.
- Both views expose type-safe editable fields; edits update the same draft record.
- Shared field overlays are purple, including fields reached through collection-to-collection references.
- Records have independent switches in the publication modal, deduplicated across uses.
- Publishing a record updates its live uses; editing an unpublished draft does not.
- Removing/reordering references changes the placement, not the referenced records.
- Query-backed lists use the same rendering scopes but do not expose misleading manual membership/order controls.
- Labels reject unknown/non-text field keys at type-checking time.
- Field primitives reject incompatible collection field names.
- Collection references are validated against the correct collection and site/environment.
- `articles.pages()` provides a working derived item loader and route discovery, including an empty collection.
- External-data layouts use ordinary loader/routes functions with the same envelope conventions.
- `layout.useData()` returns unwrapped data; only collection-bound results expose the editable item scope.
- A wrapper returning a collection loader's envelope preserves editability without function metadata.
- A missing/unpublished public item does not render draft content.
- Block reference-list Markdown reflects that block's chosen presentation, not a collection-wide default.
- Directly rendered layout content is represented in Markdown using the same live/preview visibility rules.
- No per-item block tree, public ORM, expanded schema primitive API, or generated-link editor integration is needed to complete this scope.
