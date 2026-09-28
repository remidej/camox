# Multi-page editing canvas

## Status and intent

This document records the canvas direction explored during product discussion.
It is a plan, not documentation of shipped behavior. The intended UX is described
below; implementation recommendations and unresolved questions are called out
separately.

### Initial experimental slice

The first implementation is a separate, read-only `/camox/canvas` Studio page,
gated by `enableExperimentalFeatures`, with a Canvas navbar link. It does not
replace edit mode or change the existing page editor.

This slice includes a solid theme-muted canvas, smooth pointer-anchored zoom, drag/scroll
panning, desktop-width full-height page frames, and one frame per derived
template with an instance-path editor. It has no editing sidebars or preview
toolbar. The URL remains `/camox/canvas`; selection-driven routing, editing
overlays, block manipulation, and publication changes remain future work.

Every page reserves a desktop-width slot (1366px), with 240px between slots.
Headers are single-row text directly on the canvas, without a card background,
border, or shadow, with a consistent unscaled height at every zoom level.
The nickname sits on the left; the path uses the theme foreground for contrast
against the gray canvas and appears at the right
when the projected header is at least 320px wide. There are no Show paths or
read-only instruction overlays. Clicking a derived header opens a fixed-size popover with
input groups for its route parameters, even when its path is hidden.

There is no device selector in page headers. The current canvas uses desktop;
a future app-wide toolbar control will switch all previews together. Narrower
previews will be centered in their existing desktop-width slots, keeping the
page arrangement and header widths stable.

For isolation, the prototype adapts exact `100vh`/`100svh`/`100lvh`/`100dvh` height
declarations in each iframe's accessible CSSOM rather than changing the site's
Tailwind build. This preserves existing selectors, layers, and media conditions,
and leaves the normal editor and published styles untouched. Broader viewport
compatibility and the shared Tailwind stylesheet below remain proposed work.
Site document scripts do not execute in these read-only frames.

Replace the single-page edit-mode preview with a zoomable canvas containing
multiple real pages side by side. Editors can see and edit the actual site, not
mockups, while retaining the benefits of code and agents.

The canvas also changes Studio's organizing model: instead of Studio living
inside one page, Studio owns a workspace containing pages, with one selected page
providing context for page-specific controls.

## Intended experience

### Canvas and page selection

- Entering edit mode shows pages side by side on a canvas.
- Editors can pan and zoom out to see multiple pages, or zoom in to edit one.
- The canvas is finite: its rectangle contains the full row of pages up to the
  tallest page, plus comfortable padding and room for page headers. Panning stops
  at those bounds. The minimum zoom fits that whole rectangle, rather than using
  a fixed percentage floor, and the initial view shows the complete overview.
- These are camera limits, not a visible boundary: the solid theme-muted background fills
  the entire viewport. Extra space on the shorter axis remains canvas, with no
  bars or separate surrounding surface.
- The fitted overview defines one fixed world-space rectangle, including that
  shorter-axis spare space. Zoom projects this same rectangle rather than
  recomputing screen-space margins or recentering an axis that still fits.
  Zooming in preserves the pointer anchor; panning can use the overview's spare
  space, even when the page itself is narrower than the viewport.
- Bounds update when page content, device presets, or the Studio viewport change.
  An overview stays fitted as pages finish loading; a zoomed-in working view is
  preserved unless it must be brought back within the new bounds.
- Each page preview displays its full document height, without an inner document
  scrollbar. Nested scrollable components are a separate compatibility concern.
- Selecting a page updates the browser URL and the page-specific sidebar content.
  It does not visibly navigate, replace the canvas, or remount other pages.
- Leaving edit mode makes the selected page fill the available preview area, as
  it does today, with normal viewport and scrolling behavior.
- Keep the selected page and its iframe mounted across the presentation change.
  Changing sizing and chrome should not inherently reset component state.
- On returning to the canvas, preserve its useful working context rather than
  resetting the workspace.

The prototype remembers zoom and pan in an in-memory XState canvas store, scoped
by API, project, environment, and runtime mount. Leaving the route and returning
restores the last displayed camera; a saved fit-all view continues to fit as pages
load. Temporary iframe placeholder sizes may clamp the display but do not overwrite
the saved view. New camera input takes precedence over restoration. Page trees do
not subscribe to animation updates. This does not persist across browser reloads.

Selection is a page identity, not a consequence of which page happens to be
nearest the center of the screen. Recommended initial behavior: panning and
zooming do not change selection or create browser-history entries.

The exact initial page arrangement, reload persistence, and history policy are
not yet settled. Start with an orderly arrangement rather than requiring editors
to maintain a freeform board.

### Device presets

An app-wide toolbar control will select desktop, tablet, or mobile for all
previews together. Page headers do not contain device selectors.

- Preview widths are predefined, not derived from the size of the Studio window.
- Resizing the Studio window changes the visible canvas area, not page layout.
  Canvas zoom can compensate for available space.
- Changing the app-wide device preset changes every preview's rendering dimensions
  and triggers overlay remeasurement, without changing slot or header widths.
- Canvas zoom scales the rendered page without changing its layout width or
  responsive breakpoint.

Implementation recommendation: each preset should also define a logical viewport
height. For example, a desktop preset might be 1440 × 900; these numbers are
illustrative, not agreed defaults. The logical height is distinct from the full
document height and is needed for viewport-dependent sizing.

### Templates and generated pages

Render one canvas frame per template, not one per generated URL. An input above
the frame lets the editor choose which instance to display.

Keep these identities distinct:

- The template represented by the frame.
- The selected instance and its URL.
- The ownership of the content being edited.

Choosing an instance does not make shared template edits instance-specific.
Controls must communicate whether an edit affects the chosen instance, shared
layout content, or another shared source.

## Rendering model and viewport compatibility

### The central constraint

A full-height iframe is not a normal browser viewport with scrolling removed.
Native viewport units use the iframe's actual dimensions. An 8,000px-tall iframe
makes `100vh` equal 8,000px, even if the intended desktop viewport height is 900px.

This can distort heroes and cause sizing feedback loops when document height
depends on viewport height and is then used to resize the iframe.

Keep three concepts separate:

1. **Logical viewport:** device dimensions used for authoring.
2. **Document size:** the full rendered content extent displayed on the canvas.
3. **Canvas transform:** pan and zoom used to display that document in Studio.

There is no standard iframe setting that independently gives native CSS a short
viewport while exposing the entire tall document. Switching to `dvh` or `svh`, or
scaling the iframe, does not solve that distinction.

### Proposed solution: adapt Tailwind viewport utilities

Camox sites use Tailwind and shadcn. Use that existing authoring convention rather
than asking every block to adopt new class names.

A shared, site-facing Camox stylesheet can redefine the named viewport-height
utilities to use a logical-height variable with a native fallback:

```css
@utility h-screen {
  height: var(--camox-viewport-height, 100vh);
}

@utility min-h-screen {
  min-height: var(--camox-viewport-height, 100vh);
}

@utility h-dvh {
  height: var(--camox-viewport-height, 100dvh);
}
```

Site code remains ordinary Tailwind:

```tsx
<section className="min-h-screen">...</section>
```

In canvas mode, set the variable inside each page's iframe:

```css
:root {
  --camox-viewport-height: 900px;
}
```

Remove the override in normal preview; published rendering uses the native
fallback. Scope the override to page documents, not Studio's own UI.

Cover the named viewport utilities for height, minimum height, and maximum height,
including `screen`, `svh`, `lvh`, and `dvh` where applicable. In canvas mode these
can use the same fixed logical height; outside it each retains its native fallback.
Width utilities need no equivalent override when iframe width already equals the
device width.

**Evidence so far:** a compiler-only experiment using the repository's installed
Tailwind 4.3.0 confirmed that a same-name custom `@utility` generates its declaration
after the built-in utility, including responsive variants. This is not yet a
browser-tested integration or a shipped stylesheet.

**Coverage limits:**

- Arbitrary values such as `h-[80vh]` and `min-h-[calc(100dvh-4rem)]`.
- Inline styles, custom CSS, and third-party styles outside the overridden utilities.
- Height-dependent media queries.
- JavaScript reading native viewport dimensions such as `innerHeight`.

Initially document the variable for unsupported cases and teach Camox's
agent-facing instructions to use it. Consider a parsed CSS transformation only
if actual usage warrants broader coverage. A `camox/dom` helper could expose
logical dimensions to cooperating JavaScript, but cannot redefine native CSS
viewport semantics.

### Fixed, sticky, animated, and hidden content

Tailwind sizing overrides do not solve positioning. A shadcn dialog using
`fixed top-1/2` still centers against the actual tall iframe viewport. Fixed
headers, sticky elements, nested scrollers, and viewport-based lazy loading also
need evaluation.

The proposed fallback for hidden content is:

1. Leave edit mode.
2. Interact with the page to open a modal or reveal content.
3. Return to edit mode with that state preserved.

Keeping the iframe mounted avoids an unnecessary reset, but does not guarantee
that arbitrary site code preserves state after resize or that a modal remains
usefully positioned. Modal placement on re-entry remains an open design question.
A focused, normal-viewport editing presentation is a possible fallback, not an
agreed additional mode.

Scroll-driven effects also need an explicit authoring policy. A no-scroll,
full-height page cannot reproduce normal scroll progress. Intersection-triggered
reveals may activate too early, and lazy content may load eagerly.

Recommended prototype policy: supported reveal effects show their completed,
editable state on the canvas; faithful scroll behavior is checked in normal
preview. Helpers through `camox/dom` may support this, but their API and coverage
are not decided. Do not promise transparent compatibility with arbitrary widgets.

## Studio-owned overlays

Move editing overlays out of the site's rendering and into Studio-owned layers.
This removes site stacking/clipping constraints and enables richer UI, including
comments displayed next to their target elements.

Use one overlay system with two rendering layers:

| Layer                    | Contents                                                      | Behavior                                                     |
| ------------------------ | ------------------------------------------------------------- | ------------------------------------------------------------ |
| Canvas-transformed layer | Element outlines and anchor markers alongside page frames     | Moves and scales with the page                               |
| Screen-space layer       | Comment cards, toolbars, menus, readable interaction controls | Keeps a usable screen size while following projected anchors |

Store element geometry in page-local coordinates. Project an anchor through the
page's canvas position and the camera transform to place screen-space UI. Panning
and zooming should update that projection, not require measuring every element
again.

No inner document scrolling removes a major synchronization problem, but geometry
is not static. Remeasure after:

- Text edits and wrapping changes.
- Block insertion, removal, and reordering.
- Device-preset or template-instance changes.
- Fonts, images, or asynchronous content changing layout.
- Revealed content and other supported component-state changes.

Batch reads after rendering rather than interleaving repeated layout reads and
writes. An edit near the top can move anchors below it without resizing those
targets, so invalidation must cover affected positions, not only the edited
element's own size.

Wrapped inline content, detached or portaled content, disappearing targets, and
remaining nested scroll areas need explicit handling. Measuring only once on
entry to edit mode is not sufficient.

## Block insertion and direct manipulation

### Replace peeking with a gallery

Remove the behavior that temporarily inserts and animates a candidate block
inside the live page while browsing available blocks. It was confusing and
destabilizes canvas geometry.

Instead, show available blocks and their thumbnails in a modal gallery. Reuse the
existing [thumbnail renderer](../packages/sdk/src/features/preview/components/BlockThumbnail.tsx#L13)
rather than creating a separate rendering system. Confirming insertion updates
the actual page and invalidates affected overlay geometry.

### Reorder blocks directly in preview

The canvas should support block reordering from the page itself, not only from
the sidebar. Reuse the existing ordering operation used by the
[sidebar drag handler](../packages/sdk/src/features/preview/components/PageTree.tsx#L347).

Recommended interaction:

1. Hover or select a block to reveal a drag handle. Do not make arbitrary content
   draggable at the expense of text editing and selection.
2. Show a compact drag ghost, such as a thumbnail or block label. Leave the
   original block dimmed in place to keep layout stable during the gesture.
3. Show an insertion indicator between valid neighboring blocks.
4. Commit the new order on drop, then remeasure overlays.

Studio owns the drag gesture and maps pointer coordinates into the page using
the canvas transform. Capture pointer events reliably across iframe boundaries.
Panning near canvas edges should allow moving blocks through a long page.

Initially limit moves to the same page and editable block region. Prevent drops
into shared layout regions or code-controlled template content when the operation
is not supported. Retain keyboard/sidebar reordering as an alternative.

Dragging a new block from the gallery into a page is a follow-up opportunity.
Cross-page dragging is deferred until move/copy/synced-instance semantics are
explicit.

## State, routing, and lifecycle

Separate workspace ownership from individual page-preview ownership.

- **Workspace:** camera, selected frame, app-wide device preset, global Studio controls, and active
  interaction.
- **Frame:** page/template identity, displayed instance, iframe
  reference, rendering inputs, and geometry.
- **Selection:** frame identity plus the existing content target. Shared content
  can appear in multiple frames; the content ID alone does not identify the
  visual occurrence being edited.

The current [runtime navigation](../packages/sdk/src/features/runtime/pageNavigation.tsx#L47)
couples URL changes to replacing the current page input. The
[preview store](../packages/sdk/src/features/preview/previewStore.ts#L72) also holds
one iframe and one selection. Both assumptions need to be separated from the
workspace model.

Each mounted frame needs its own route context, base URL, and instance inputs.
Updating the host URL to reflect selection must not change what other frames
believe their route is. Page selection and in-page navigation are distinct actions.

Deep links and refresh must restore the relevant selected page or template
instance. Back/forward should restore selection without replacing the whole
canvas; exact push-versus-replace policy remains to be specified.

Preserve the selected iframe across canvas/full-screen transitions. Avoid separate
render trees that destroy and recreate it merely to change presentation.

## Performance and scale

Seeing many pages must not require running every page at full cost indefinitely.
Full-height previews can activate videos, scripts, effects, data requests, and
lazy content even when visually tiny.

Recommended direction:

- Keep the selected frame live.
- Use a bounded set of additional live frames around the visible working area.
- Explore cached representations for distant frames, preserving their dimensions.
- Avoid evicting the selected page during presentation changes.
- Use one frame per template with an instance picker, rather than enumerating all
  generated URLs.

The live-frame budget, caching strategy, and treatment of inactive component state
need prototyping. Do not introduce virtualization that unexpectedly loses an
active editor, comment draft, or interaction state.

Provide conventional page navigation and useful camera actions, such as fitting
the selected page's width or bringing a selected block into view. Very long pages
become unreadable strips when fitting the entire site; zoomed-out orientation
must not be the only way to find or edit content.

## Site-wide controls and opportunities

The canvas creates a natural home for site-level actions in the navbar, while
sidebars remain contextual to the selected page.

Publishing is a candidate for this move, but moving the button and supporting a
site-wide release are separate changes. The
[current publication model](../packages/sdk/src/features/preview/publication.ts#L33)
supports a page with an optional layout, or a whole layout. Broader publication
needs explicit scope, dependencies, permissions, and failure behavior.

A global entry point should let editors review what will change, not silently
interpret “publish” as every draft in the site. True site-wide publishing is not
a prerequisite for validating or shipping the canvas.

Other opportunities, not initial requirements:

- See the effect of shared-block edits across multiple pages.
- Review comments across the site, with cards anchored to their elements.
- See which pages and blocks an agent changed.
- Compare responsive variants side by side, beyond the app-wide device switcher.
- Review affected pages before publishing.

## Suggested implementation sequence

### 1. Validate the rendering contract

Build a small prototype with two or three full-height frames and a deliberately
difficult page: a viewport-height hero, sticky header, lazy image, scroll reveal,
and modal.

Verify:

- Named Tailwind viewport utilities use logical preset height on the canvas.
- Normal preview restores native viewport behavior.
- Document-height measurement converges rather than growing in a feedback loop.
- Changing device presets reflows the page; changing canvas zoom does not.
- Modal state survives presentation changes, with remaining placement problems
  documented.

Do this before investing in broad site-wide UI.

### 2. Separate workspace and frame ownership

Introduce multiple page instances, explicit selection, per-frame route context,
and contextual sidebar data. Validate URL changes, refresh, and history without
remounting unrelated pages.

### 3. Add canvas overlays and editing

Implement camera transforms, frame-local geometry, and the two overlay layers.
Start with selection outlines and one anchored comment card. Exercise inline
editing, delayed fonts/images, device changes, and content below an edited block.

### 4. Replace peeking and add preview reordering

Ship the thumbnail gallery without live insertion previews. Add handle-based
reordering with stable drag geometry, valid region boundaries, and existing
mutation/error handling. Keep the sidebar alternative.

### 5. Harden scale and broaden Studio controls

Measure realistic multi-page workloads, then add the live-frame budget and caching
needed by those results. Move appropriate controls into the navbar without
implicitly expanding their backend scope.

## Open decisions

- Exact device dimensions, especially logical heights.
- Packaging/import of the Tailwind compatibility stylesheet and coverage of
  arbitrary viewport-dependent CSS.
- Full-height measurement rules for overflowing and dynamically sized content.
- Modal/fixed/sticky behavior and whether a focused viewport editing fallback is
  necessary.
- Supported animation/lazy-loading behavior and any `camox/dom` authoring helpers.
- Canvas arrangement, camera persistence across reloads, history policy, and in-preview link
  behavior.
- Instance-picker discovery, default instance, and empty/error states.
- Live-frame lifecycle, caching, and preservation of inactive page state.
- Initial global feedback/publication UI scope.

The key feasibility test is not whether pan and zoom can be implemented. It is
whether full-height authoring previews remain useful and predictable for the
Tailwind/shadcn sites Camox supports, while normal preview remains available for
real viewport behavior.
