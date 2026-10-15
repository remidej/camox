# Managing Pages and Blocks with the Camox CLI

Read [cli-common.md](cli-common.md) first for `{{CAMOX_CMD}}`, help verification, and the dev-first workflow.

Use these commands for Pages, metadata, Layout assignments, Blocks and their Content, and review. To change Block schemas or rendering, read [Block Definitions](block-definitions.md); to create or change Layout Definitions, follow the code-definition routing in [the Camox skill](../SKILL.md).

## Pages

### Create a Page with an existing Layout

```sh
{{CAMOX_CMD}} layouts list
{{CAMOX_CMD}} pages create --path-segment about --layout-id default
```

`--layout-id` takes a Layout's name, the `layoutId` listed by `layouts list`.

Use `--parent-page-id <ID>` to nest the Page under another Page.

### Read and edit SEO metadata

```sh
{{CAMOX_CMD}} pages get --path /about
{{CAMOX_CMD}} pages update --path /about --meta-title "About us" --meta-description "Meet the team."
{{CAMOX_CMD}} pages update --id <PAGE_UUID> --meta-description ""
{{CAMOX_CMD}} pages update --id <PAGE_UUID> --ai-seo on
{{CAMOX_CMD}} pages update --id <PAGE_UUID> --ai-seo off
```

Updates accept exactly one of `--id` or `--path` and require at least one update
field. Omitted fields are preserved; an empty string clears a metadata field.
Setting either metadata field disables automatic SEO for both fields and cannot
be combined with `--ai-seo on`. Disabling AI preserves current metadata; enabling
it schedules asynchronous generation, so read the Page again to inspect results.

Metadata edits apply right away in the selected Environment. Read metadata
with `pages get`.

## Comments

List a Page's comments, then use a returned comment `id` to resolve one on that same Page:

```sh
{{CAMOX_CMD}} comments list --page-id <PAGE_UUID>
{{CAMOX_CMD}} comments resolve --page-id <PAGE_UUID> --id <COMMENT_UUID>
```

`--page-id` is the Page's UUIDv7 (find it with `pages get --path /about`); `--id` is the comment's UUIDv7, not a Block or Page ID. Resolution changes the comment's status, not the Page's content. Check `comments resolve --help` before writing, per [CLI common guidance](cli-common.md). Use `--json` for structured output; `--project`, `--production`, and `--cwd` select the same project, environment, and working directory as other CLI commands.

## Blocks

### Inspect before changing

Look up the Page before creating or moving Blocks so you have its `id`, current Blocks, and any sibling ids. Describe the Block type before constructing Content:

```sh
{{CAMOX_CMD}} pages get --path /
{{CAMOX_CMD}} blocks describe --type hero
```

### Find shared navigation and footer Blocks

`pages get` returns page-owned Blocks, not the Layout's shared shell. Inspect
the Layout to discover navigation, footer, and other layout-owned block IDs:

```sh
{{CAMOX_CMD}} layouts list
{{CAMOX_CMD}} layouts get --layout-id default
{{CAMOX_CMD}} blocks get --id <BLOCK_UUID>
{{CAMOX_CMD}} blocks edit --id <BLOCK_UUID> --content '{"title": "Updated title"}'
```

Pass the Layout's name, the `layoutId` from `layouts list` (also the Page's
`layoutId`), to `layouts get --layout-id`. The response
includes `blocks` with `id`, `type`, `slot`, and Content, plus
`layout.beforeBlockIds` and `layout.afterBlockIds`. Pass a Block's `id` to
`blocks get` and `blocks edit`; do not use the Layout ID or Block type.
Inspect the Block's schema and current Content before editing, and preserve
repeatable items as described below.

Keep `--project`, `--production`, and `--cwd` consistent across the
discovery and editing commands. `--production` selects the environment.
Shared shell edits affect every Page using that Layout,
and synced Block types can share Content across Layouts.

### Create and position a Block

```sh
{{CAMOX_CMD}} blocks create --page-id <PAGE_UUID> --type hero --content '{...}' --position first
```

Creation initializes omitted Content and Settings fields from the Block definition's defaults, including when `--content '{}'` is supplied. Explicit values are not replaced by defaults and must satisfy the field's JSON Schema; defaults do not merge into a supplied Link object. Omitted Repeaters initialize their default item count (or minimum count) with item defaults. Supplied arrays use exactly those items and must satisfy `minItems`/`maxItems`; `[]` is accepted only when the minimum allows it. Asset placeholders are not stored. Existing synced Block data still takes precedence for synced types.

Content and Settings writes are validated server-side against the owning environment's schemas before mutation. Validation errors include field paths. String fields contain Markdown strings (not rich-text JSON objects); Embed fields contain strings matching their pattern. Assets use managed `{ "_fileId": "<file UUIDv7>" }` references, with asset lists stored as arrays of references. Asset normalization drops hydrated URL metadata and converts placeholders to null.

Updates validate only submitted fields, so unrelated historical invalid values do not prevent an edit. New records validate after defaults are applied. Unknown properties follow the schema's `additionalProperties` policy (allowed when unspecified); missing definitions retain legacy permissive behavior. Saved snapshots are not retroactively migrated or revalidated when restored.

Supply reference-specific copy, links, assets, and items directly as instance Content. Definition defaults should remain neutral, reusable examples—not a way to populate a reference site.

`blocks create` and `blocks move` accept the same positioning flags. Pass at most one:

| Flag                      | Meaning                                         |
| ------------------------- | ----------------------------------------------- |
| `--position first`        | Put the Block first.                            |
| `--position last`         | Put the Block last; this is the create default. |
| `--after-id <ID>`         | Put it immediately after a sibling Block.       |
| `--before-id <ID>`        | Put it immediately before a sibling Block.      |
| `--after-position <KEY>`  | Insert after a known fractional-index key.      |
| `--before-position <KEY>` | Insert before a known fractional-index key.     |

Prefer `--position`, `--after-id`, and `--before-id`. A move requires one positioning flag.

### Edit Block Content

Content patches merge ordinary fields, so send only fields that should change:

```sh
{{CAMOX_CMD}} pages get --path /pricing
{{CAMOX_CMD}} blocks edit --id <BLOCK_UUID> --content '{"headline": "New headline"}'
```

### Set string fields from files

Use `--field-file <NAME>=<PATH>` on `blocks create` and `blocks edit` to set a top-level string field to a file's raw contents, without escaping it into JSON. It suits long Markdown and [Artifact](artifacts.md) sources. Repeat the flag to set several fields. It merges with `--content`; when both set the same field, the file wins. On `blocks create`, pass `--content`, `--field-file`, or both.

```sh
{{CAMOX_CMD}} blocks edit --id <BLOCK_UUID> --content '{"title": "Orbit"}' --field-file source=./orbit.html
```

Every file is read before anything is written, so a missing or unreadable file fails the command without changing anything.

To build an Artifact source, loop until it renders correctly:

1. Write the source to a local file, such as `./orbit.html`.
2. Push it with `blocks edit --id <ID> --field-file <NAME>=./orbit.html` (or `blocks create` for a new Block).
3. Check the rendered page with `{{CAMOX_CMD}} preview`, following [CLI common guidance](cli-common.md).
4. Edit the file and push again.

### Edit repeatable Content safely

A repeatable field's array is replacement-shaped: omitting an existing item deletes it and cascades to its file references, settings, and nested items. Fetch the Block, preserve every existing item with `_itemId`, and add changes only to the intended entries:

```sh
{{CAMOX_CMD}} blocks get --id <BLOCK_UUID>

{{CAMOX_CMD}} blocks edit --id <BLOCK_UUID> --content '{
  "items": [
    {"_itemId": "<ITEM_UUID_1>"},
    {"_itemId": "<ITEM_UUID_2>", "answer": "Updated answer."},
    {"_itemId": "<ITEM_UUID_3>"}
  ]
}'
```

The response's `repeatableItems` contains each item's `id`, `fieldName`, `parentItemId`, and Content. Use the same `_itemId` pattern recursively for nested repeatables. Fetch multiple Blocks together when useful:

```sh
{{CAMOX_CMD}} blocks get-many --id <BLOCK_UUID> --id <BLOCK_UUID> --id <BLOCK_UUID>
```

`blocks get-many` returns the same bundle shape as `blocks get`, in requested-id order.

## Review

```sh
{{CAMOX_CMD}} pages get --path /pricing
{{CAMOX_CMD}} blocks get --id <BLOCK_UUID>
```

Reads return the current content. Pages, Layouts and Blocks have no separate draft or published state: every edit is visible on the site of the selected Environment right away.
