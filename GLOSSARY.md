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

**Project ID**:
A project's permanent identifier, given when it is created and never changed. A website's code names its project by it.
_Avoid_: UUID, project key

**Project Slug**:
A project's `camox.site` subdomain: its address, unless it has a Custom Domain, which it then redirects to. Unique across Camox, and unlike the Project ID, it can change.
_Avoid_: Handle, project name

**Custom Domain**:
A domain a project is served at instead of its `camox.site` subdomain. A project has at most one.
_Avoid_: Hostname, vanity URL

**Template**:
The starter website a new project's code begins as, before it is given the project's name and slug.
_Avoid_: Starter, boilerplate, scaffold

**Project Setting**:
A choice that applies to a whole project, the same for Live and every draft, and takes effect without publishing, such as its favicon or analytics providers.
_Avoid_: Site setting, config

**Release**:
What a change to a project's code starts: syncing a build's definitions to Live (adding any content they declare that Live lacks), then serving that build. Publishing a draft releases the build of its last revision, the one its preview showed; any other change, such as an Upgrade, is built for its release. A failed release leaves the previous code served.
_Avoid_: Build, deploy, ship

**Upgrade**:
Moving a project's code to a newly published SDK, and releasing it if it builds. Every SDK publish upgrades every project; one that doesn't build keeps its code and its previous release.
_Avoid_: Migration, bump

**Deploy Token**:
The secret that authorizes a release for a project.
_Avoid_: Sync secret, API key

### Definitions (code-owned)

**Definition**:
A code-owned description of a kind of content (a block, layout, or collection), synced into Live by a release and into a draft that changes code by each of its revisions.
_Avoid_: Model, type, template

**Definition Set**:
All of a website's definitions taken together, with the content they declare. A release syncs one to Live, and each revision syncs one to its draft.
_Avoid_: Manifest, schema

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
The web page an artifact holds, stored as content: only what its author wrote, without the artifact shell.
_Avoid_: Artifact code, artifact HTML

**Artifact Shell**:
What a website wraps around every artifact source: Camox's artifact runtime and the website's fonts. It's the same for every artifact of a release.
_Avoid_: Wrapper, harness, template

**Artifact Document**:
The page an artifact's frame loads: its artifact source inside the artifact shell, inlined in the frame or loaded by URL.
_Avoid_: Artifact page, artifact source (for the whole page)

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

### Design (code-owned)

**Theme**:
The design decisions in a website's code that every block draws from: colors, fonts, type sizes, corner radii and spacing.
_Avoid_: Design system, style, skin

**Color Scheme**:
One of the color sets a theme defines, such as light, dark or brand, that a block or part of one switches to.
_Avoid_: Theme, mode

**Brand Color**:
The theme's main color, used for what visitors click: buttons, links and focus rings.
_Avoid_: Primary color

**Accent Color**:
The theme's second color, used for what visitors look at but don't click, such as eyebrows, highlighted words, badges and decorations, so a page isn't monochrome.
_Avoid_: Secondary color (clashes with secondary buttons)

### Content

**Page**:
A routable piece of the website, belonging to one layout and holding an ordered list of blocks.
_Avoid_: Route, screen, URL

**Layout Page**:
A page of a singleton or derived layout, whose blocks all belong to its layout, as opposed to a page of a curated layout. A contributors' term: editors only ever see pages.
_Avoid_: Code-owned page, static page, generated page

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
A generated value: a short description of a block's or repeatable item's content, used to identify it to editors and agents. Until one is generated or written by hand, the block or item is identified by its title, which its definition's `toTitle` builds from its default-locale content.
_Avoid_: Description, label, excerpt

**Generated Value**:
A value AI derives from content (a summary, a page's SEO, or a file's alt text and filename), kept beside the content rather than in it, so producing one never changes a draft. A value written by hand takes its place. SEO and alt text are generated in each locale; summaries and filenames in the default locale only.
_Avoid_: AI field, AI metadata, derived content

**Structured Data**:
The JSON-LD graph Camox renders in each page's head, describing the website's Organization, the website and the page as linked nodes, built from the project, the page and definitions' `toStructuredData`.
_Avoid_: Schema, schema markup, rich snippets

**Markdown Representation**:
The text a block, or a layout rendering loaded data, declares to stand for its content when read by agents.
_Avoid_: Export, plain text

### Localization

**Locale**:
A language, optionally narrowed to a region, that the website is published in. Like content, locales are added and removed through drafts, not in code. The studio calls locales "languages".
_Avoid_: Language, market, region, translation

**Default Locale**:
The locale every other locale derives from, published at unprefixed paths.
_Avoid_: Source language, primary language, main locale

**Localization**:
A content entity's copy in one locale, linked to its original in the default locale: a page, a block (including layout blocks and synced blocks' shared content), a repeatable item, or a collection record. It may diverge from its original wherever someone changed it on purpose.
_Avoid_: Translation, variant, localized page

**Alternate**:
A page as it exists in one locale, at its path under that locale's prefix. A page's alternates list every locale it exists in, its own included, and leave out locales it was removed from. The `hreflang` links, the sitemap and a locale switcher all come from them.
_Avoid_: Translation, language version, hreflang

**Bookkeeping**:
A localization's invisible record of the source it was last translated from and what Camox wrote from that source. Comparing it with the source and the localization now tells a source change from a hand edit. Writing it is never a change or a conflict.
_Avoid_: Translation memory, sync state, baseline

**Exclusion**:
The record that a localization was deleted from its locale on purpose, so translation leaves it, and everything beneath it, out of that locale through later changes to its original. Content created in a locale other than the default one exists only there and is never excluded. Exclusions are changes that publishing keeps on Live; adding the localization back deletes its exclusion.
_Avoid_: Tombstone, opt-out, removal

### Publishing

**Live**:
The published state of the website, served to the public. Live only changes when a draft is published or a release syncs its definitions.
_Avoid_: Production, production environment, main

**Draft**:
A named set of changes to the website's content and code, kept apart from Live until it is published or deleted, which ends it. Many drafts can be open at once, each started by an editor, Camox's agent, a Connected Agent, or Camox, and every member can see, edit, publish, or delete any of them. Editing while viewing Live always starts a new draft, unnamed until a member keeps it by naming it, publishes it, or discards it. Every other draft starts named.
_Avoid_: Branch, environment, changeset, working copy

**Revision**:
One state of a draft's code, left each time the agent builds its changes, at the end of an agent turn that changed code, by a merge of Live's code, or by a member pushing commits from their own checkout. A turn can leave several. Each is built once, the draft's preview shows the last one that built, and its definitions are what the draft's content uses from then on. Publishing serves the last revision's build on Live. A contributors' term: editors only ever see the draft.
_Avoid_: Version, build, snapshot

**SDK Bundle**:
Camox, React and the npm packages websites share with Camox, built ahead of time and shared by every website that resolves them to the same versions. A revision's build holds only the website's own code and names the SDK Bundle it runs with, which never changes once built. A contributors' term.
_Avoid_: Shell, vendor bundle, runtime bundle

**Whole-app build**:
A build of a website that holds Camox, React and the packages it shares with Camox itself, instead of naming an SDK Bundle: what every build was before SDK Bundles, and what a build from a Camox that doesn't build against one still is. It keeps working wherever it's served. A contributors' term.
_Avoid_: Full build, monolithic build, legacy build

**Publish**:
Applying all of a draft's changes to Live at once, releasing its code together with its content when it changed any. A draft is always published whole, never in parts, only once it has no blockers, no open findings and nothing left to translate, and the Live content it replaces is not kept.
_Avoid_: Deploy, release, merge

**Catch-up Draft**:
A draft Camox opens to translate what a release added to Live, and publishes by itself once it's done. A project has at most one open.
_Avoid_: Translation draft, system draft, bot draft

**Draft Overview**:
A headline and bullets AI writes about a draft's changes, shown at the top of its review, with a short name it suggests for keeping an unnamed draft. It describes the draft rather than its content, so it is not a Summary or a Generated Value: it is never published to Live, never a change or a conflict, and has no hand-written override.
_Avoid_: Draft summary, changelog, description

**Delete**:
Ending a draft without publishing it, so its changes are lost.
_Avoid_: Revert, undo

**Discard**:
Deleting a draft nobody has named yet: the changes an editor made while viewing Live, before anyone kept them as a draft.
_Avoid_: Delete (for an unnamed draft), revert, undo

**Blocker**:
A problem in a draft that prevents publishing it until it is fixed in the draft, such as a duplicate path, an empty required reference, code that doesn't build or type check, or code that doesn't merge with Live's.
_Avoid_: Error, validation failure

**Finding**:
A problem a patroller raises about content, in what a draft changed or on Live, such as a link that doesn't work, with the fix it suggests when it has one. A draft's findings prevent publishing it until each is fixed or a member dismisses it, and a dismissed finding is not raised again.
_Avoid_: Issue, warning, flag, suggestion

**Patrol Draft**:
The draft Camox opens to fix the findings its patrollers raise on Live, which Camox's agent works on and a member publishes. A project has at most one open, and later findings join it.
_Avoid_: Fix draft, maintenance draft, bot draft

**Conflict**:
Content that a draft changes and that Live also changed or deleted after the draft first changed it. Camox merges a localization's conflict with Live's before publishing wherever it can tell the draft's changes from Live's.
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

**Settings Section**:
The part of the studio where members change Project Settings. They apply to Live and every draft as soon as they are saved, whichever draft the studio is viewing.
_Avoid_: Preferences, admin, config

**Preview**:
The Website Section with the Canvas hidden: one page of the website, as Live or as one draft, as a visitor would see it.
_Avoid_: Iframe, view mode

**Canvas**:
A studio view that shows many pages side by side, which editors and agents pan and zoom across, and where content is selected and edited in place. The Website Section shows either the Canvas or the Preview.
_Avoid_: Board, overview, sitemap view, edit mode, design mode

**Content Sidebar**:
The sidebar on the Canvas's left side, where editors find and edit content: the Canvas Navigator, with the Canvas Inspector of the selection over it.
_Avoid_: Canvas sidebar, left sidebar

**Canvas Navigator**:
The Content Sidebar while nothing is selected: every page of the canvas, to search and pick from.
_Avoid_: Outline, page list

**Canvas Inspector**:
The Content Sidebar while a page is selected: that page's name and its content to edit.
_Avoid_: Item sidebar, page sidebar, properties panel

**Agent Sidebar**:
The sidebar on the Canvas's right side, where editors work with Camox's agent: the Patrol over the Chat widget, which shows the current Thread.
_Avoid_: Chat sidebar, right sidebar

**Patrol**:
Every patroller of a project together: the work Camox does on the website without being asked, shown at the top of the Agent Sidebar.
_Avoid_: Workers, jobs, automations, background tasks

**Patroller**:
One responsibility Camox carries out on its own, known by its role, such as the Translator or the SEO manager. Editors see whether it is working, when it last worked, what it did and what it found. It works for editors unprompted, so it is not an Agent, even when an agent loop does its work.
_Avoid_: Worker, bot, job

**Report**:
A patroller's account of the last thing it did to one subject in one locale, in a draft or on Live, or of one whole run for patrollers that have no subject. Redoing the work updates the report rather than adding one, and work that changed nothing leaves none.
_Avoid_: Entry, log, activity, event

**Dashboard**:
The hosted interface for managing organizations and their members, and for creating, opening and deleting projects, outside any one website. A project's settings live in its studio, not here.
_Avoid_: Admin, console

**Editor**:
A human who changes content through the studio.
_Avoid_: Author, admin, content manager

**Agent**:
An AI that manages content alongside editors: Camox's own, through threads in the studio.
_Avoid_: Bot, assistant, AI

**Connected Agent**:
An AI outside Camox, such as a member's Claude or ChatGPT, that the member connects to Camox and that acts on their behalf, with their permissions. It brings what it knows about the member's business, and Camox's agent does the work on the website.
_Avoid_: External agent, client, assistant, integration

**Thread**:
A conversation with Camox's agent, held by editors in the studio and by Connected Agents. Each editor has one thread of their own on Live, kept for good, and each draft has at most one, shared with everyone in it. The agent on Live changes nothing itself: for each request that would, it starts a draft, whose thread takes the request on from a brief, and the Live thread starts afresh from that draft's card. A Connected Agent starts a draft itself, its own message opening the draft's thread.
_Avoid_: Conversation, chat, session

**Artifact Agent**:
The part of Camox's agent that writes and changes one artifact's source, remembering every earlier request about it. Editors never see it apart: in a thread, its answers read as the agent's.
_Avoid_: Subagent, artifact worker, artifact thread

**Brief**:
What Camox's agent writes when it starts a draft from a Live thread: the context the editor's request depends on, opening the draft's thread ahead of the request itself. Camox writes one too when it opens the Patrol Draft, listing the findings its agent is there to fix, and starts the agent with it.
_Avoid_: Summary, context note, handoff message

**AI Usage Record**:
What one AI call, or the sandbox compute around it, cost: what it was for, who and what it was for (organization, project, draft, thread), who started it (a member, the agent, or Camox itself, naming the patroller), the model and provider used, its tokens, and its cost as billed or estimated at the time. Written once and never changed, without prompts or outputs, and kept after what it names is gone.
_Avoid_: Usage event, log, generation, billing record
