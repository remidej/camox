---
name: camox
description: Use when working in a Camox codebase with Block Definitions, Layout Definitions, Pages, Block content, the Camox CLI, or publishing. Applies to code-defined site structure and agent-driven content changes.
---

# Camox

Read only the references needed for the current task. Do not preload every reference.

## Code definitions

- Create a block or change its schema or field rendering API in `src/blocks/`:
  [Block Definitions](references/block-definitions.md).
- Create or change a curated layout (a reusable shell for editor-created pages), including navbar/footer layout slots:
  [Layout Definitions](references/layout-definitions.md).
- Create or change a singleton page (a code-owned fixed URL) or derived route (a code-owned data-driven route) in `src/layouts/`:
  [Routed layouts](references/routed-layouts.md).
- Share content across layouts with `synced: true`, independently of `layoutOnly`:
  [Synced blocks](references/block-definitions.md#synced-blocks-synced-optional).

## Localized code

Every block, layout and component renders in every locale the project publishes:

- Put every visible text in blocks, layout blocks included. Camox translates block content, never JSX.
- Pass internal links through `useLocalizedHref` from `camox/navigation`, and write paths without a locale prefix.

For a locale switcher, a loader fetching localized data, or the details of either rule: [Localization](references/localization.md).

## Specialized block work

- DOM listeners, scrolling, browser scripts, or third-party widgets:
  [DOM integrations](references/dom-integrations.md).
  Preview DOM lives in an iframe; component globals target the editor.
- Customize inline text/link formatting or highlights:
  [Field styling](references/field-styling.md).
- Bespoke visuals or widgets as code (animations, 3D scenes, interactive widgets), declaring `field.artifact` or writing an artifact source:
  [Artifacts](references/artifacts.md).

For specialized changes to an existing block, read the specialist reference directly. Also read Block Definitions only if creating a block or changing its schema or other field rendering APIs.

## Interactive blocks

Use the platform. Build tabs, dialogs, carousels, menus and disclosures from native HTML and CSS (`<details name>`, `<dialog>` with `command`/`commandfor`, `popover`, scroll snap), and reach for JS only where modern HTML can't do the behaviour. Compose the project's own Components in `src/components/ui/` when it has them (Camox's Template ships accordion, tabs, dialog, carousel and mobile menu). Target Baseline Newly available, with a fallback that keeps the content reachable in browsers lacking the feature, and keep every tab, dialog and slide in the page's markup, opened or not, and reachable with the keyboard. Editors edit hidden content by turning the Canvas off, opening it, and turning the Canvas back on.

## Content and CLI

For any CLI operation, first read [CLI common guidance](references/cli-common.md), then only the relevant command reference:

- Pages, metadata, layout assignments, Blocks, content, or ordering:
  [CLI Content](references/cli-content.md).
- Where the CLI writes, publishing or deleting the development draft, or its status:
  [CLI Publishing](references/cli-publishing.md).

Code definitions do not place blocks on existing Pages or assign their layouts; `blocks.initial` only seeds the initial homepage. When the request includes placement or assignment on existing Pages, follow with the relevant CLI workflow. Singleton pages and derived routes are declared in code, not created through the pages CLI.

A request can cross boundaries. Load an additional reference only once that need is established.
