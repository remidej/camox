---
name: camox
description: Use when working in a Camox codebase with Block Definitions, Layout Definitions, Pages, Block content, the Camox CLI, publishing, or Environments. Applies to code-defined site structure and agent-driven content changes.
---

# Camox

Read only the references needed for the current task. Do not preload every reference.

## Code definitions

- Create a block or change its schema or field rendering API in `src/blocks/`:
  [Block Definitions](references/block-definitions.md).
- Create or change a curated layout (a reusable shell for editor-created pages), including shared navbar/footer placement:
  [Layout Definitions](references/layout-definitions.md).
- Create or change a singleton page (a code-owned fixed URL) or derived route (a code-owned data-driven route) in `src/layouts/`:
  [Routed layouts](references/routed-layouts.md).
- Share content across layouts with `synced: true`, independently of `layoutOnly`:
  [Synced blocks](references/block-definitions.md#synced-blocks-synced-optional).

## Specialized block work

- DOM listeners, scrolling, browser scripts, or third-party widgets:
  [DOM integrations](references/dom-integrations.md).
  Preview DOM lives in an iframe; component globals target the editor.
- Customize inline text/link formatting or highlights:
  [Field styling](references/field-styling.md).

For specialized changes to an existing block, read the specialist reference directly. Also read Block Definitions only if creating a block or changing its schema or other field rendering APIs.

## Content and CLI

For any CLI operation, first read [CLI common guidance](references/cli-common.md), then only the relevant command reference:

- Pages, metadata, layout assignments, Block instances, content, ordering, or publishing:
  [CLI Content](references/cli-content.md).
- List comments on a Page or resolve a comment by its ID:
  [CLI Content — Comments](references/cli-content.md#comments).
- Production targeting or environment replication:
  [CLI Environments](references/cli-environments.md).

Code definitions do not place blocks on existing Pages or assign their layouts; `blocks.initial` only seeds the initial homepage. When the request includes placement or assignment on existing Pages, follow with the relevant CLI workflow. Singleton pages and derived routes are declared in code, not created through the pages CLI.

A request can cross boundaries. Load an additional reference only once that need is established.
