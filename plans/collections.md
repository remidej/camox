# Collections

Status: product direction. Exact schema, query, mutation, and editing APIs remain to be designed independently of the derived-layout work.

## Purpose

Collections are a Camox-managed ORM: typed structured data with storage and editing managed by Camox. Users define collections, create and edit records in Camox, and access those records through application code.

A collection exists independently of pages, layouts, and blocks. It can hold articles, authors, products, or other application data, even when none of its records has a corresponding page. A slug is an ordinary field, not an implicit route declaration.

External databases and APIs remain ordinary application dependencies. They do not need to be represented as Camox collections to work with derived layouts.

## Core responsibilities

- Schema definitions that describe record fields and validation.
- Camox-managed persistence and stable record identities.
- Strongly typed reads, queries, creates, updates, and deletes.
- A Camox interface for browsing and editing records independently of page editing.
- Project/environment scoping and authorization for data access.
- Schema synchronization and an explicit approach to schema evolution.

Collection definitions should determine the types of records, query inputs, and mutation inputs without requiring users to repeat those types. Static types and runtime validation should agree. Read and write access must enforce authorization regardless of which interface invokes them.

The physical storage model is not settled. Calling collections an ORM does not yet choose between physical tables per collection, shared record storage, or another implementation.

## Relationship to layouts

[Curated and derived layouts](./derived-layouts.md) owns the routing and rendering design: `kind: "curated" | "derived"`, file-based declarations, server-side `loader` functions, and `Layout.useData()`.

A derived layout's loader can import and query a collection just as it can call an application database or external API. The layout receives the loader result; it does not receive a special `collection` option or collection-specific props. One loader may combine multiple collections and external sources, and multiple layouts may consume the same collection.

Collections do not define route patterns, page templates, metadata, or layout ownership. Creating a record does not automatically insert a page row; updating or deleting one does not directly rewrite or cascade-delete pages. A loader determines how source data affects a derived page at request time.

Derived pages do not support individually authored page blocks in the current phase, so collection records do not need backing page records for custom blocks. Future structured or block-based record fields belong to the collection/block API design.

Collection management can be implemented separately from derived layouts. Conversely, derived layouts can ship using application databases or external APIs before collections exist.

## Relationship to blocks

Collections should support future block APIs for:

- Referencing a single record, such as a featured article.
- Selecting and ordering records manually, such as a curated article list.
- Querying records, such as recent articles or articles about a topic.
- Rendering and potentially editing individual collection fields in context.

These capabilities should work on curated pages as well as derived pages. A reference to a record does not imply that the record has a URL.

Exact field builders, bindings, query serialization, reference storage, and inline editing behavior are deferred to the collection/block API design. The previous `bindBlock`, proxy-recorded lambdas, and `$entry` token proposals are not settled requirements.

Layout editing remains as described in the derived-layout plan: shared `before`/`after` blocks have purple overlays for both layout kinds. Only curated pages support page-specific `children` blocks with pink overlays in this phase. Editing a collection field changes the underlying record; its UI and persistence must be distinguished from editing a shared block or page-owned block.

## Authoring and lifecycle

Users should be able to manage records directly in a Collections area without creating or visiting a page. Programmatic access and the editor should operate on the same schema and records.

Collection record lifecycle is separate from layout publishing. Drafts, publishing, preview visibility, and scheduling for records require their own design; they should not be inferred from whether a consuming layout is published.

Changing a record may affect multiple consumers. Reference behavior on deletion and refresh/cache behavior after mutations need explicit contracts rather than automatic page materialization or deletion.

## Open design work

- Collection declaration syntax and schema/field builders, including reuse with block fields.
- Typed query and mutation API, filtering, sorting, pagination, and missing-record behavior.
- Constraints, indexes, relationships, and validation rules.
- Record identity, physical storage, and environment behavior.
- Schema synchronization and migration strategy.
- Record drafts, publishing, previews, and permissions.
- Block references, curated selections, query-backed lists, and field editing.
- Cache invalidation and handling deleted references.

Do not carry forward the old plan's SQL columns, endpoint signatures, collection-specific layout overload, path/filter serialization, or page materialization flow. Design the collection API around independent data management, and integrate it through the ordinary loader and future block APIs.
