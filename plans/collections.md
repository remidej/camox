# Collections — v1 specification

## Slice 2 decision: record history and checkpoints

Pages/layouts persist immutable checkpoints and switch an explicit live pointer;
synced blocks overlay the latest independently published data on current live
reads, but not on explicit historical reads. Collections follow that distinction,
without copying page/block trees or sharing their restoration behavior.

- A record has a stable UUID, an isolated mutable draft, and an explicit current
  published revision pointer. Publication snapshots that one record only.
- Revisions are immutable, versioned snapshots of content and its definition.
  Manual checkpoints and publication create revisions. Restoration first saves
  the displaced draft, then replaces only this record's draft. Publication remains
  separate. Historical reads return exactly the requested revision, never an overlay.
- Draft/history access and every mutation require site membership. Every lookup
  also scopes by site, environment, and collection. Public reads return only the
  current published revision, or null for a missing/unpublished record.
- Mutations require the expected record version to prevent lost updates. A failed
  publication may leave an unreferenced immutable snapshot, never partial live data.
- Missing definitions are retired, not deleted. Re-registration revives them.
  With existing records, sync permits additive fields only; existing field
  definitions cannot change or disappear. New fields must have valid initial
  values: declared scalar defaults (otherwise empty text, false, or the first enum
  option), null single assets, and empty asset lists. Asset preview defaults are
  never stored. Draft backfills and schema sync are atomic and advance affected
  record versions, without rewriting history or publishing content. Restoring an
  older revision fills fields added since that revision using the same rule.
  Metadata/label changes remain possible. A general migration framework and
  environment-copy support are not part of this slice.
- Compatibility guard: environment replication and site deletion are blocked before
  destructive work only when collection records/history exist. Empty code-owned
  definitions do not block existing workflows. Replication leaves empty collection
  definitions to code sync; deletion removes them. This is a deliberate temporary
  limitation, not silently incomplete replication.
- String storage preserves plain strings and validated current Camox Lexical inline
  state (constraints apply to extracted text). Distinct Link/Repeater/Icon fields
  fail at definition creation/sync until their record storage is supported.

## Slice 3 decision: management and standalone publication

- Experimental Studio exposes code-defined collection browsing and schema-driven
  create/edit forms. Save changes/Create item writes only a draft; publication
  is a separate list action. Background refetches never replace in-progress edits
  or advance the form's reviewed version.
  The browser reuses PagePicker's Draft, Published, and Modified badges.
  The Publish/Publish changes and ellipsis button group is visible on row hover
  or keyboard focus. The ellipsis lists Unpublish and Discard changes, disabled
  when inapplicable.
- Standalone publication uses the existing scope/impact confirmation dialog.
  The explicitly chosen item's switch defaults **on** each time the dialog opens;
  switching it off disables confirmation. Cancel never mutates content. No other
  record, block, page, or layout is implicitly included.
- List publication, unpublication, and discard require confirmation and the reviewed record
  version. A concurrent edit causes a conflict, not publication of unseen changes.
  Unpublishing clears only the live pointer, retaining draft and immutable history.
  Discard restores the current published revision through the validated, scoped
  restore service and preserves the displaced draft in history; it never changes
  live content and rejects records without a published revision.
  Successful operations invalidate record/browser queries in the scoped environment.
- AI collection discovery, schema/draft reads, create/edit, publish/unpublish and
  delete call the same validated services. The tool session supplies the project
  and environment, never caller-controlled scope. Publish/unpublish/delete carry
  `requiresApproval` metadata for tool consumers, following existing page tools.
  This is not a server-enforced approval gate: the authenticated tool execution
  endpoint executes handlers directly. Draft writes do not imply publication.
- **Future reference rule:** when reference publication planning is implemented,
  independently selectable changed dependencies default on, matching shared-content
  switches, but remain explicit in the review. An excluded already-published item
  retains its previous live revision. A required dependency with no live revision
  must block publication unless included in a validated atomic publication plan;
  never silently publish it or substitute a draft. Optional absent/unpublished
  references resolve as empty, never drafts.
- **Slice 3 safety boundary:** reference schemas/resolution/pickers and dependency
  publication are not implemented or exposed. The validation layer rejects
  Reference/ReferenceList fields. There are no supported record dependencies to
  traverse, cascade, or protect yet. Unpublish/delete currently act on standalone
  records only; dependency checks, deletion safety, deduplication and atomic
  reference publication must land together in the later reference slice before
  references can be enabled. Publishing a standalone record creates no URL.
- The playground Customers collection and its README provide a repeatable standalone
  create/edit/publish/unpublish example; articles remain available for lifecycle tests.

## Slice 4 decision: single references

- A top-level block `field.reference(collection, { required?: boolean })` stores
  only a UUID or null. Resolution is separate from authored block content and
  always scopes the record by project, environment, and collection. References
  in settings, repeaters, and collection schemas remain outside this slice.
- `block.Reference` passes a typed field scope to its child callback. Source
  record identity is independent of the rendered block/field occurrence:
  multiple placements edit one draft, but selection and overlays identify the
  occurrence. Shared fields have purple outlines and use the source record label.
  Missing/unset references render an editor attachment placeholder, never a fake
  record; public rendering is empty.
- _Revised after slice 4 landed:_ records are edited like repeater items, not in a
  modal. The sidebar drills Block › Reference field › Record › Record field (for
  example Testimonial › Customer › Acme › Quote), with breadcrumbs. The reference
  field view owns linking (and, for lists, reordering): a record card (no image or
  icon; label truncated with an ellipsis; publication badge, collection title, X with an **Unlink**
  tooltip and no confirmation) and, only when unlinked, a combobox. **Create item**
  lives only in the combobox footer, as in PagePicker; it opens the existing create
  modal prefilled with the search text and links the saved record. The record view
  shows the record fields; only records reached through a reference list also get
  a shared header. Purple stays in the preview, never in the sidebar. The record
  view has no publish control.
  Record and record-field selections identify the occurrence plus the record, and
  drive preview highlights on the selected occurrence only. In preview, record
  fields (including images and files) are selectable and editable inline.
  A cancelled creation never changes the link, and unlinking never deletes the record.
- Draft resolution reads draft records; live resolution reads only published
  revisions. Editing a source refreshes its draft occurrences, not live content.
  Independently publishing a source refreshes live occurrences. Referenced assets
  are included in hydration and retained through collection revisions.
  An owner checkpoint preserves reference selection (the UUID), not a pinned
  source revision: historical page/layout reads resolve that selection against
  the source's current published revision, never its draft. Explicit collection
  revision reads still return exactly that immutable revision.
- Publication review deduplicates source items across placements. Changed source
  switches default on and retain the reviewed expected version. Excluding an
  already-published source retains its old live revision; excluding an optional
  unpublished source leaves the public reference empty.
- Required references may be unset in drafts, but block publication must reject an
  absent required target or a required unpublished target excluded from the plan.
  Included record and owner publication pointers must move together atomically;
  immutable prepared snapshots are not themselves publication.
- Deletion cannot leave dangling supported references. Unpublication cannot make
  a required live reference disappear. Optional unpublished references resolve
  empty, never to drafts.
- Per-use Markdown accesses the reference's fields, for example
  `c.company.company` in the testimonial. There is no collection-level Markdown
  callback and no copied source content in the placement.
- The playground testimonial's company demonstrates single references. Existing
  plain-text company values are not converted into records automatically; the
  editor explicitly attaches a Customers item.

## Slice 5 decision: manual reference lists

Recorded from #132. Only manual lists in top-level block content are in this half
of slice 5; references in repeaters, settings, and collection schemas, relation
depth and cycles, and query-backed lists (slice 6) remain open.

- `field.referenceList(collection, { title?, description?, maxItems?, toMarkdown? })`
  carries field type `ReferenceList`, the collection id, and the collection's content
  schema. It stores an ordered array of distinct record UUIDs and defaults to `[]`.
  There is no `required` or `minItems`: an empty list is always valid. Entries have
  no settings; per-placement presentation belongs in a repeater item.
- Schema validation accepts lists at the top level of block content only. Value
  validation (shared services, so agent tools get the same errors) rejects ids outside
  the field's collection, project, or environment, duplicates, and lists over
  `maxItems`, with field-named errors.
- Draft resolution returns every linked record in stored order; live resolution
  returns only records with a published revision, in stored order. Missing records
  are skipped. Checkpoints store the ordered ids, never pinned revisions, so history
  and live views resolve them against current published records.
- The dependency index expands list values into one non-required use per linked
  record (migration `0030_reference_lists` redefines the view; triggers stay).
  Deleting a record any draft or live list links is refused; unpublishing it is
  allowed; page, layout, and synced-block publication is never blocked by list
  entries; placement writes linking a missing record are refused.
- Linked records join the deduplicated publication review (changed records default
  on) and are never "missing required".
- `block.ReferenceList` renders its child once per resolved record with the same
  typed record scope as `block.Reference`, and renders nothing for an empty list.
- Editors manage a list in the reference field view: sortable record cards with
  **Unlink** (never-published records are only shown by their Draft badge), and a combobox that appends (hiding linked
  records, replaced by "Limit of {maxItems} reached" at `maxItems`, **Create item**
  appends). The field list summarizes a list as "{n} linked". Writes send the whole
  array. Record and record field views are unchanged; selection shapes are reused
  (uniqueness makes them unambiguous) and placement ids include the record id.
  A selection whose record left the list falls back to the reference field view.
- In the preview each listed record is a placement like a single reference's record:
  clicking a record field selects `record-field`, clicking elsewhere in the record
  selects `record`, and inline edits write the shared record. Overlay ids are
  `block__field__record` for a placement and `block__field__record__recordField` for its
  fields, for single references too, so hover and focus messages derive from the
  selection alone and only the targeted entry is outlined.
  In edit mode an empty list shows a dashed "Add {collection}" placeholder.
- The list's per-use `toMarkdown` runs per resolved record, like repeater items, and
  the block includes it through its content token; live Markdown omits unpublished
  records.
- The playground logo grid links customers shared with the testimonial.

## Slice 5 decision: references in repeatable items

Recorded from the second half of slice 5. Repeatable item content accepts the same
`field.reference` and `field.referenceList` builders as block content, at any repeater
depth. Item settings, block settings and nested objects still reject them.

- An item stores and validates its references exactly like a block: UUIDs (or null) and
  ordered distinct id lists, checked in scope by the shared services on every write path
  (item create with nested seeds, item edits, block create/edit with inline items, layout
  and project bootstrap). Errors name the item path, e.g. `logos[0].customer`.
- `required` keeps its block meaning: a required item reference may be unset in drafts,
  but page/layout publication reports it missing (`block.item.field`) and rejects it, and
  a required live item reference cannot be unpublished.
- Reads hydrate each item's own `references`, resolved against its item schema (found by
  walking its repeater path); live reads resolve published records only, from checkpoints
  and shared synced data alike. The SDK records map includes records linked only by items.
- The dependency index gains item placements (migration `0031_repeater_references`):
  draft items from `repeatable_items`, live items from checkpoints and synced data. D1
  caps compound SELECTs at five terms, so block and item placements are separate views.
  Item writes get the same missing-record race guards as block writes.
- Publication review deduplicates item-linked records with block-linked ones.
- Item Markdown resolves `{{customer.name}}` and reference lists through the item's own
  references, in the repeater's per-item `toMarkdown`.
- Item scopes expose `Reference` and `ReferenceList` with the same typed record scope.
  Placements carry the item: overlay IDs are `block__item__field__record`, selections add
  `itemId`, and stepping up from an item's record leads to the item's reference field,
  then the item. The sidebar drills Block › Repeater › Item › Reference field › Record.
- Per-placement presentation lives on the item (for example an `emphasized` setting next
  to the customer reference); the record stays shared.
- The playground's customer highlights block demonstrates item references.

## Slice 5 decision: references between collections

Recorded from the last part of slice 5. Collection schemas accept `field.reference` and
`field.referenceList`, for example an author linking the articles they wrote.

- Collection references are never `required`: an unpublished target resolves empty live,
  never as a draft. A collection references only collections synced alongside it.
- Record writes validate references like block writes (scope, collection, distinct ids,
  `maxItems`), through the same services the editor and agent tools use. Added reference
  fields backfill as unset (`null`, `[]`).
- Resolution is bounded at two hops: records a block or item places (the first hop)
  resolve the records they link (the second hop) under their own `references`; second-hop
  records resolve nothing further, so cycles cannot expand. The SDK records map is flat by
  id; record scopes expose `Reference` and `ReferenceList` at the first hop only, in types
  and at runtime.
- The dependency index gains record placements (migration `0032_collection_references`):
  each record's draft and current published revision. Deleting a record that any record
  draft or live revision links is refused; unpublishing it is allowed; record writes get the
  missing-record race guard.
- Publication review adds second-hop records once each, as non-required switches defaulting
  on when changed. Their status compares against their own published revision.
- Placements gain a `nested` hop: overlay IDs append `__recordField__linkedRecord`, and a
  linked record steps up to the first record's reference field, then to that record. The
  sidebar drills Block › Reference field › Record › Record reference field › Linked record;
  second-hop record views edit their own reference fields but never open further records.
- Per-use Markdown walks nested paths (`c.author.articles`, `c.article.author.name`).
- The collection create/edit form edits reference fields with the record picker, without
  Create item (it would replace the form's own modal).
- The playground's author bio block demonstrates two hops: block → author → articles.
- Not covered: a page's derived Modified status does not yet reflect second-hop record edits;
  the publication review still lists them.

## Slice 6 decision: query-backed reference lists

Recorded from #142 (core in #143, editor in #144). This settles the query and ordering part
of remaining decision #4.

- `field.referenceList(collection, { query: { orderBy?, limit? } })` declares a query-backed
  list. `orderBy` is a single-key object `{ [key]: "asc" | "desc" }` whose key is a `String`
  field of the collection (the label included) or the system key `createdAt` or
  `publishedAt`; images, references, enums, booleans and multi-key orderings are rejected.
  `limit` is an integer from 1 to 100 and defaults to the hard cap of 100. There is no
  `where` filtering in v1. Types reject unknown keys, several keys and literal limits outside
  1–100; the builder and definition sync (`validateReferenceSchema`, checking keys against the
  `referenceSchema` the field carries) reject the same, computed limits included.
- `createdAt` and `publishedAt` are reserved collection field names, in types, in
  `createCollection` and at collection sync.
- The query is part of the definition. A query-backed list has no `default` and stores
  nothing: a value stored on the block or item is ignored, the field is never required, and
  every content write naming it (block or item create, block or item edit, inline items) is
  rejected by `validateReferenceValues` as `{path}: query-backed reference lists are resolved,
not written`.
- Lists are accepted in block content and repeatable item content at any repeater depth.
  Settings, nested objects and single references reject a query; collection schemas reject
  query-backed lists, so second-hop resolution never fans out across a collection.
- Resolution (`resolveReferences`) loads the collection's records and orders them in memory:
  - draft reads every record by its draft content; live reads published records only, by
    their published revision's content, so a draft title change never re-sorts a live list;
  - `publishedAt` is the earliest `auto-publish` revision (falling back to the current
    published revision), so republishing never bumps a record; in preview, never-published
    records sort as published now;
  - text compares the plain text with the ICU English collation, numbers by value
    (`Intl.Collator("en", { numeric: true })`): case-insensitive, "Article 2" before
    "Article 10". Missing or empty values sort last in either direction;
  - ties break by record id, ascending. Without `orderBy`, records keep creation order
    (`createdAt` ascending);
  - results are first-hop records and resolve their own references (the two-hop rule).
    No stored first-publication column was added; revisit if large collections make in-memory
    ordering slow.
- Query results are resolved content, not placements. Migration `0033_query_reference_lists`
  redefines `collection_reference_uses` to skip list fields carrying a `query`, so they never
  block deleting or unpublishing a record and never mark a page or layout Modified. The
  publication review skips them, including the records they would reach at the second hop.
- Invalidation needs nothing new: every record write (edit, publish, unpublish, delete)
  already invalidates block, page and layout reads, so preview and live lists refresh, and
  live membership changes on record publication without republishing the page.
- The SDK renders results through the same `ReferenceList` scope, overlays, selection shapes
  and placement ids as a manual list. Results come from the owner's resolved `references`
  (blocks by id, items through the items map), not from stored content. In edit mode an empty
  result renders nothing: there is no "Add" placeholder.
- Per-use `toMarkdown` runs per resolved record; live Markdown uses live resolution.
- Editor (#144): the sidebar reads the field's `query` from the block or item schema. The field
  list summarizes the list as "{n} results" ("1 result"), counting the owner's resolved records.
  The reference field view shows a summary line derived from the query, then the results as
  read-only record cards in result order, each opening its record view and highlighting its
  entry in the preview on hover. There is no Unlink, drag handle, record picker, Create item
  or limit message, and an empty result shows only the summary. Summaries: dates read
  "Newest 3 by published date" / "Oldest 5 by creation date" ("Newest first …" without a
  limit); text fields read "First 2 by {field title}, A to Z" ("All by …" without a limit,
  "Z to A" descending); without `orderBy`, "Oldest first by creation date". A record or
  record-field selection stays valid while the record is among the owner's resolved results
  (a query-backed list stores nothing to check), and falls back to the list view once it
  leaves them.
- Agent tools share the validation and resolution services; their reference guidance says
  never to write query-backed lists.
- The playground's recent articles (`publishedAt` desc, limit 3) and article list (`title`
  asc) blocks demonstrate both. The `/articles` singleton index stays with slice 8.

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
import { createCollection } from "camox/createCollection";

export const customers = createCollection({
  id: "customers",
  title: "Customers",
  description: "Customers featured in testimonials and case studies.",

  content: (field) => ({
    name: field.string({ default: "New customer" }),
    logo: field.image(),
    quote: field.string(),
    spokesperson: field.string(),
  }),

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

  content: (field) => ({
    customer: field.reference(customers),
  }),

  settings: (setting) => ({
    showLogo: setting.boolean({ default: true }),
  }),

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
content: (field) => ({
  customers: field.referenceList(customers, {
    maxItems: 24,
    toMarkdown: (customer) => [customer.name],
  }),
}),

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
content: (field) => ({
  articles: field.referenceList(articles, {
    query: {
      orderBy: { title: "asc" },
      limit: 3,
    },
    toMarkdown: (article) => [
      `## ${article.title}`,
      article.excerpt,
    ],
  }),
}),
```

- Query keys and supported operators must be typed against the collection.
- Camox owns fetching, server rendering, publication filtering, and preview updates.
- Record fields remain editable through the same scoped primitives.
- Query membership and ordering are not manually editable selections. The editor must not offer drag-to-reorder or removal controls that contradict the query.
- Manual lists store ordered references. Query results are resolved content, not block-owned copied items.
- The query operator set (`orderBy`, `limit`) and ordering on system metadata (`createdAt`, `publishedAt`) are settled in "Slice 6 decision". New date/number field APIs are not introduced by this document.

This is the declarative integration for list/index/recent-content use cases; no public ORM or block loader is required.

### References inside collections and repeaters

The same `field.reference` and `field.referenceList` builders work in collection schemas, for example an article referencing an author. They also work in repeater content for local placement settings.

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

Historical reads must not silently substitute today's shared data for historical content.
Standalone history is settled in slice 2, and switch defaults and unpublished-dependency
policy are settled in slice 3 above. Historical representation/restoration of references
remains for the reference slice.

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

## Playground articles examples

Implement working examples in `apps/playground` as part of the collections feature, not just documentation snippets. Use the articles use case to demonstrate the same records in multiple presentations, while preserving the existing playground examples.

### Collection and demo content

- Define and register an `articles` collection with `title`, `slug`, `excerpt`, `cover`, and `body` fields using the supported field types. Use `title` as its type-safe label.
- Provide a repeatable demo-content setup with at least four published articles and one draft, with distinct titles, excerpts, and bodies so reuse and publication behavior are easy to inspect.
- Keep the body field-based. Do not introduce per-article block trees, a public ORM, or new schema primitives for the example.

### Three presentations

1. **Article detail:** a derived layout at `/articles/$slug`, using `articles.pages({ by: "slug", param: "slug" })` for its loader and route discovery. Render editable record fields through `layout.Item` and provide layout-owned Markdown.
2. **Articles index:** a singleton layout at `/articles`, containing a query-backed article-list block. Show a different projection of the same records, such as title, cover, and excerpt, with per-use reference-list Markdown.
3. **Recent articles:** a reusable block placed on another playground page, showing the three most recent published articles through a query-backed `ReferenceList`. This depends on finalizing the system-metadata ordering contract listed below; do not introduce a date-field API solely for this example.

### Demonstrated behavior

- Editing an article title or excerpt in either list updates the same draft record shown on its detail page and in the other list.
- Collection-backed fields have purple overlays. The publication modal exposes the article's independent switch and deduplicates repeated uses.
- Draft edits remain private; publishing the article updates all live presentations and, where relevant, recent-list membership and route discovery without republishing their containing pages.
- Public views and public route discovery omit the draft-only article; authorized preview can edit it.
- Include verification of empty-list rendering, empty route discovery, and a missing article returning `notFound()`.
- Document how to initialize the demo content and which playground URLs to open. These examples must be usable in a fresh development environment, not rely on records in an existing developer database.

## Remaining decisions

These are not permission to expand v1 into the explicitly deferred features:

1. Atomic dependency publication planning implementing the slice 3 policy, before references are exposed.
2. Checkpoint representation and historical/restore semantics for referenced record revisions.
3. Delete/unpublish policy for referenced items, including references held by other collections and published snapshots.
4. ~~Query operator set, system-metadata ordering~~ (settled in "Slice 6 decision"), and
   relation-resolution depth/cycle handling.
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
- The playground includes the working articles collection, derived detail page, singleton index, and recent-articles block, with repeatable demo setup and verification of shared editing/publication.
- No per-item block tree, public ORM, expanded schema primitive API, or generated-link editor integration is needed to complete this scope.
