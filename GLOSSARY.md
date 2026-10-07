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

**Project**:
One website managed by Camox, owned by an organization.
_Avoid_: Site, app

**Environment**:
An isolated copy of a project's content and definitions. Each project has one production environment and per-developer development environments.
_Avoid_: Stage, branch

**Production Environment**:
The environment that holds the content served on the live website.
_Avoid_: Prod site, main

**Development Environment**:
A developer's personal environment, used while running the website locally.
_Avoid_: Dev site, sandbox, local environment

**Push / Pull**:
Replicating one environment's content into another, allowed only when their definitions are compatible.
_Avoid_: Sync, copy, deploy

**Release**:
Building the website and syncing its definitions to the production environment.
_Avoid_: Deploy, ship

**Deploy Token**:
The secret that authorizes a release for a project.
_Avoid_: Sync secret, API key

### Definitions (code-owned)

**Definition**:
A code-owned description of a kind of content (a block, layout, or collection) that Camox syncs into each environment.
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

**Setting**:
One named entry in a settings schema: a boolean or an enum, edited outside the rendered content.
_Avoid_: Option, toggle, variant

**Field**:
One named entry in a content schema, of a kind such as string, image, link, icon, embed, repeater, or reference. Booleans and enums are settings on blocks and repeatable items, but fields on collection records.
_Avoid_: Property, attribute

**Layout**:
A code-owned page frame that wraps pages and owns the blocks rendered before and after their content.
_Avoid_: Template, page type

**Curated Layout**:
A layout whose pages are created and arranged by editors.
_Avoid_: Normal layout, editable layout

**Derived Layout**:
A layout whose pages come from a route pattern and data loaded in code, rather than being authored one by one.
_Avoid_: Template, dynamic layout, generated layout

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

**Nickname**:
A page's editor-facing name, distinct from its path and meta title.
_Avoid_: Page title, name

**Block**:
One placement of a block definition, on a page or in a layout, with its own content and settings.
_Avoid_: Section, component, instance

**Synced Block**:
A block definition whose content and settings are shared by every placement in an environment, and published independently of the pages containing it.
_Avoid_: Global block, shared block, symbol

**Repeatable Item**:
One entry of a repeater field, owned by its parent block or item and holding its own content and settings.
_Avoid_: Repeater item, child, row

**Collection Record**:
One independently identified, reusable entry of a collection.
_Avoid_: Item, entry, document

**Label**:
The text field of a collection that names its records to editors.
_Avoid_: Title, display name

**Reference**:
A field that selects a collection record by identity instead of copying its content.
_Avoid_: Relation, link, foreign key

**Placement**:
Where a block or reference occurs; placements keep their own identity and order even when their content is shared.
_Avoid_: Usage, instance, occurrence

**File**:
An uploaded image, video, or document available to an environment's content. The studio calls files "assets".
_Avoid_: Media, upload

**Summary**:
A short AI-generated description of a block's or repeatable item's content, used to identify it to editors and agents.
_Avoid_: Description, label, excerpt

**Markdown Representation**:
The text a block declares to stand for its content when read by agents.
_Avoid_: Export, plain text

### Publishing

**Draft**:
The current editable state of content, visible only to authorized editors.
_Avoid_: Working copy, unsaved changes

**Live**:
The published state of content, served to the public.
_Avoid_: Production content, public version

**Publish**:
Making a draft live. Pages, layouts, synced blocks, and collection records each publish independently.
_Avoid_: Deploy, release, save

**Unpublish**:
Removing content from live while keeping its draft and history.
_Avoid_: Delete, hide, archive

**Discard Changes**:
Resetting a draft back to its live state.
_Avoid_: Revert, undo

**Checkpoint**:
An immutable snapshot of a page's or layout's content at a point in time, created manually, on publish, or automatically while drafting.
_Avoid_: Version, revision, snapshot, backup

**Revision**:
An immutable snapshot of one collection record's content.
_Avoid_: Checkpoint, version

**Modified**:
Status of published content whose draft differs from its live state.
_Avoid_: Dirty, changed, outdated

### Editing

**Studio**:
The in-website editing interface used by editors to change content.
_Avoid_: Admin, editor, back office, CMS UI

**Preview**:
The rendered website shown inside the studio, where content is edited in place.
_Avoid_: Iframe

**Edit Mode**:
The state of the preview in which content can be selected and changed, as opposed to browsing the website as a visitor would.
_Avoid_: Editing state, design mode

**Canvas**:
A studio view that shows many pages side by side at once.
_Avoid_: Board, overview, sitemap view

**Dashboard**:
The hosted interface for managing organizations, projects, and members, outside any one website.
_Avoid_: Admin, console

**Comment**:
Feedback left by a user on a page, optionally anchored to a block, repeatable item, or field.
_Avoid_: Note, annotation, feedback

**Editor**:
A human who changes content through the studio.
_Avoid_: Author, admin, content manager

**Agent**:
A coding agent that manages content through the CLI or AI tools, working alongside editors on the same drafts.
_Avoid_: Bot, assistant, AI
