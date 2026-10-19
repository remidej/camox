# Camox

Camox is a CMS framework for websites that coding agents build and manage over time. Developers define the building blocks in code; editors and agents assemble and publish content from them.

## Language

### Tenancy

**Organization**:
A group of users who share access to a set of projects.
_Avoid_: Team, workspace

**Member**:
A user who belongs to an organization, with a role in it.
_Avoid_: Collaborator, seat

**Visitor**:
Someone viewing Live who isn't a member of the project's organization.
_Avoid_: Guest, audience, end user

**Project**:
One website managed by Camox, owned by an organization.
_Avoid_: Site, app

**Project Setting**:
A choice that applies to a whole project, the same for Live and every draft, and takes effect without publishing, such as its favicon or analytics providers.
_Avoid_: Site setting, config

**Release**:
Building the website and syncing its definitions to Live, adding any content they declare that Live lacks.
_Avoid_: Deploy, ship

**Deploy Token**:
The secret that authorizes a release for a project.
_Avoid_: Sync secret, API key

### Definitions (code-owned)

**Definition**:
A code-owned description of a kind of content (a block, layout, or collection), synced into Live by a release and into a development draft by running the website locally.
_Avoid_: Model, type, template

**Block Definition**:
The code-owned description of a block type: its content schema, settings schema, defaults, and component.
_Avoid_: Block type, component, section

**Content Schema**:
The typed shape of the authored content a block, repeatable item, or collection record holds.
_Avoid_: Fields, model, props

**Settings Schema**:
The typed shape of a block or repeatable item's presentation options, kept separate from its content.
_Avoid_: Options, config, props

**Block Setting**:
One named entry in a settings schema: a boolean or an enum, edited outside the rendered content.
_Avoid_: Setting (alone), option, toggle, variant

**Field**:
One named entry in a content schema, of a kind such as string, image, link, icon, embed, artifact, repeater, or reference. Booleans and enums are block settings on blocks and repeatable items, but fields on collection records.
_Avoid_: Property, attribute

**Artifact**:
A field whose content is a self-contained web page, usually written by an agent, shown isolated from the rest of the website. Used for visuals and interactions that blocks can't express, such as animations, 3D scenes, and interactive widgets. Unlike an embed, which points to someone else's page, an artifact's page is the content itself.
_Avoid_: Snippet, custom code, HTML embed, widget

**Artifact Source**:
The web page an artifact holds, stored as content.
_Avoid_: Artifact document, artifact code, artifact HTML

**Artifact Data**:
The values of sibling fields and block settings that a block shares with its artifact, so editors can change what an artifact shows without changing its source.
_Avoid_: Artifact props, artifact inputs, parameters

**Layout**:
A code-owned page frame that wraps pages and owns the blocks rendered before and after their content.
_Avoid_: Template, page type

**Curated Layout**:
A layout whose pages are created and arranged by editors.
_Avoid_: Normal layout, editable layout

**Derived Layout**:
A layout whose pages come from a route pattern and data loaded in code, rather than being authored one by one.
_Avoid_: Template, dynamic layout, generated layout

**Route Discovery**:
Code listing the pages a derived layout can render, so Camox can enumerate them without visiting each URL. Pages a derived layout does not list still render when requested.
_Avoid_: Static paths, route generation, prerendering

**Singleton Layout**:
A layout that renders exactly one page, at a fixed route.
_Avoid_: Static page, single page

**Layout Slot**:
The region of a layout, before or after the page's content, that a layout block occupies.
_Avoid_: Placement, position, region

**Layout-only Block**:
A block definition that may only be placed in a layout slot, never in a page's content.
_Avoid_: Global block, chrome

**Collection**:
A code-owned definition of reusable records that can be referenced from many blocks and pages.
_Avoid_: Content type, table, model

**Document**:
The code-owned head configuration (title, meta, links, scripts) shared by every page of the website.
_Avoid_: Root layout, shell, head

### Content

**Page**:
A routable piece of the website, belonging to one layout and holding an ordered list of blocks.
_Avoid_: Route, screen, URL

**Record Page**:
A page of a derived layout that renders one collection record, found by one of its fields.
_Avoid_: Item page, detail page, collection page

**Nickname**:
A page's editor-facing name, distinct from its path and meta title.
_Avoid_: Page title, name

**Block**:
One placement of a block definition, on a page or in a layout, with its own content and block settings.
_Avoid_: Section, component, instance

**Synced Block**:
A block definition whose content and block settings are shared by every placement on the website. Like any content, the shared content is changed through drafts, so each draft can hold its own version of it.
_Avoid_: Global block, shared block, symbol

**Repeatable Item**:
One entry of a repeater field, owned by its parent block or item and holding its own content and block settings.
_Avoid_: Repeater item, child, row

**Collection Record**:
One independently identified, reusable entry of a collection.
_Avoid_: Item, entry, document

**Label**:
The text field of a collection that names its records to editors.
_Avoid_: Title, display name

**Reference**:
A field that selects a collection record by identity instead of copying its content. A required reference can't be published empty.
_Avoid_: Relation, link, foreign key

**Reference List**:
A field that selects an ordered list of distinct collection records by identity. In a manual reference list, editors choose the records and the order belongs to the placement, not the records. In a query-backed reference list, code defines membership and order, and the records are resolved rather than chosen.
_Avoid_: Relation list, multi-reference, collection field

**Placement**:
Where a block or reference occurs; placements keep their own identity and order even when their content is shared. A collection record is placed by a block's or repeatable item's reference, or by the layout of its record page.
_Avoid_: Usage, instance, occurrence

**File**:
An uploaded image, video, or document available to the website's content. Like any content, files are added, changed, and removed through drafts. A required image or file field can't be published empty. The studio calls files "assets".
_Avoid_: Media, upload

**Summary**:
A generated value: a short description of a block's or repeatable item's content, used to identify it to editors and agents.
_Avoid_: Description, label, excerpt

**Generated Value**:
A value AI derives from content (a summary, a page's SEO, or a file's alt text and filename), kept beside the content rather than in it, so producing one never changes a draft. A value written by hand takes its place.
_Avoid_: AI field, AI metadata, derived content

**Markdown Representation**:
The text a block, or a layout rendering loaded data, declares to stand for its content when read by agents.
_Avoid_: Export, plain text

### Publishing

**Live**:
The published state of the website, served to the public. Live only changes when a draft is published or a release syncs its definitions.
_Avoid_: Production, production environment, main

**Draft**:
A named set of changes to the website's content, kept apart from Live until it is published or discarded, which ends it. Many drafts can be open at once, each started by an editor or an agent, and every member can see, edit, publish, or discard any of them. Editing while viewing Live always starts a new draft.
_Avoid_: Branch, environment, changeset, working copy

**Development Draft**:
A developer's personal draft in a project, whose definitions come from their local code instead of Live. It can only be published once a release has given Live the same definitions, and it stays open, emptied, after being published or discarded.
_Avoid_: Development environment, code draft, local draft

**Publish**:
Applying all of a draft's changes to Live at once. A draft is always published whole, never in parts, only once it has no blockers, and the Live content it replaces is not kept.
_Avoid_: Deploy, release, push, merge

**Discard**:
Deleting a draft without publishing it.
_Avoid_: Revert, undo, discard changes

**Blocker**:
A problem in a draft that prevents publishing it until it is fixed in the draft, such as a duplicate path or an empty required reference.
_Avoid_: Error, validation failure

**Conflict**:
Content that a draft changes and that Live also changed or deleted after the draft first changed it.
_Avoid_: Collision, merge conflict

### Editing

**Studio**:
The in-website editing interface used by editors to change content.
_Avoid_: Admin, editor, back office, CMS UI

**Website Section**:
The part of the studio that shows the website, as the Preview or on the Canvas, as opposed to the Content Section.
_Avoid_: Preview (for the section)

**Content Section**:
The part of the studio that lists the website's content as structured data, such as pages, collections and assets.
_Avoid_: CMS, data view

**Preview**:
The Website Section with the Canvas hidden: one page of the website, as Live or as one draft, as a visitor would see it.
_Avoid_: Iframe, view mode

**Canvas**:
A studio view that shows many pages side by side, which editors and agents pan and zoom across, and where content is selected and edited in place. The Website Section shows either the Canvas or the Preview.
_Avoid_: Board, overview, sitemap view, edit mode, design mode

**Shelf Marker**:
A labelled horizontal bar above the page headers, spanning the area of the canvas it names, such as the area holding its pages.
_Avoid_: Separator, section header

**Block Catalog**:
The area of the canvas showing every page-content block definition as live blocks to the right of all pages: each with its default content, or for a Synced Block placed on the website, its shared content.
_Avoid_: Block library, component gallery, storybook

**Dashboard**:
The hosted interface for managing organizations, projects, and members, outside any one website.
_Avoid_: Admin, console

**Editor**:
A human who changes content through the studio.
_Avoid_: Author, admin, content manager

**Agent**:
A coding agent that manages content alongside editors: through the CLI, in its developer's development draft, or through AI tools in other drafts.
_Avoid_: Bot, assistant, AI
