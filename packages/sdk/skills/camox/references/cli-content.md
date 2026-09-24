# Managing Pages and Blocks with the Camox CLI

Read [cli-common.md](cli-common.md) first for `{{CAMOX_CMD}}`, help verification, and draft-first rules.

Use these commands for Pages, metadata, Layout assignments, Block instances and their Content, draft review, and publishing. To change Block schemas or rendering, read [Block Definitions](block-definitions.md); to create or change Layout Definitions, follow the code-definition routing in [the Camox skill](../SKILL.md).

## Pages

### Create a Page with an existing Layout

```sh
{{CAMOX_CMD}} layouts list
{{CAMOX_CMD}} pages create --path-segment about --layout-id 39
```

Use `--parent-page-id <ID>` to nest the Page under another Page.

### Read and edit SEO metadata

```sh
{{CAMOX_CMD}} pages get --path /about
{{CAMOX_CMD}} pages update --path /about --meta-title "About us" --meta-description "Meet the team."
{{CAMOX_CMD}} pages update --id 25 --meta-description ""
{{CAMOX_CMD}} pages update --id 25 --ai-seo on
{{CAMOX_CMD}} pages update --id 25 --ai-seo off
```

Updates accept exactly one of `--id` or `--path` and require at least one update
field. Omitted fields are preserved; an empty string clears a metadata field.
Setting either metadata field disables automatic SEO for both fields and cannot
be combined with `--ai-seo on`. Disabling AI preserves current metadata; enabling
it schedules asynchronous generation, so read the Page again to inspect results.

Metadata edits affect only the draft, even with `--production`. Read published
metadata with `pages get --live`; publish only after user approval.

## Comments

List a Page's comments, then use a returned comment `id` to resolve one on that same Page:

```sh
{{CAMOX_CMD}} comments list --page-id 25
{{CAMOX_CMD}} comments resolve --page-id 25 --id <COMMENT_UUID>
```

`--page-id` is the numeric Page ID (find it with `pages get --path /about`); `--id` is the comment's UUID, not a Block or Page ID. Resolution changes the comment's status, not the Page's draft or published content. Check `comments resolve --help` before writing, per [CLI common guidance](cli-common.md). Use `--json` for structured output; `--project`, `--production`, and `--cwd` select the same project, environment, and working directory as other CLI commands.

## Blocks

### Inspect before changing

Look up the Page before creating or moving Blocks so you have its `id`, current Blocks, and any sibling ids. Describe the Block type before constructing Content:

```sh
{{CAMOX_CMD}} pages get --path /
{{CAMOX_CMD}} blocks describe --type hero
```

### Create and position a Block

```sh
{{CAMOX_CMD}} blocks create --page-id 25 --type hero --content '{...}' --position first
```

Creation initializes omitted Content and Settings fields from the Block definition's defaults, including when `--content '{}'` is supplied. Explicit field values—including `""`, `null`, `false`, and `[]`—are preserved; defaults do not merge into a supplied Link object. Omitted Repeaters initialize their default item count (or minimum count) with item defaults; supplying an array uses exactly those items, and `[]` creates none. Asset placeholders are not stored. Existing synced Block data still takes precedence for synced types.

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
{{CAMOX_CMD}} blocks edit --id 314 --content '{"headline": "New headline"}'
```

### Edit repeatable Content safely

A repeatable field's array is replacement-shaped: omitting an existing item deletes it and cascades to its file references, settings, and nested items. Fetch the Block, preserve every existing item with `_itemId`, and add changes only to the intended entries:

```sh
{{CAMOX_CMD}} blocks get --id 99

{{CAMOX_CMD}} blocks edit --id 99 --content '{
  "items": [
    {"_itemId": 401},
    {"_itemId": 402, "answer": "Updated answer."},
    {"_itemId": 403}
  ]
}'
```

The response's `repeatableItems` contains each item's `id`, `fieldName`, `parentItemId`, and Content. Use the same `_itemId` pattern recursively for nested repeatables. Fetch multiple Blocks together when useful:

```sh
{{CAMOX_CMD}} blocks get-many --id 99 --id 100 --id 101
```

`blocks get-many` returns the same bundle shape as `blocks get`, in requested-id order.

## Review and publishing

For curated page-content blocks, publish or discard changes at the Page level. Layout-owned blocks use layout publishing; curated Page publishing includes its Layout by default, as described below. Singleton and derived routes have no curated Page record: use layout publishing, not `pages publish` (see [Routed layouts](routed-layouts.md)).

### Review draft and live state

```sh
{{CAMOX_CMD}} pages get --path /pricing        # draft
{{CAMOX_CMD}} pages get --path /pricing --live # published snapshot
{{CAMOX_CMD}} blocks get --id 314              # draft
{{CAMOX_CMD}} blocks get --id 314 --live       # published snapshot
```

Live reads fail when the Page or Block has never been published. `--live` is not a write target and does not publish anything.

### Publish after approval

```sh
{{CAMOX_CMD}} pages publish --path /pricing
```

`pages publish` accepts exactly one of `--id` or `--path`. It publishes the Page's current draft and, by default, its Layout. Publishing the Layout is a no-op when it has no pending changes. Use `--no-layout` only when the user explicitly does not want pending Layout changes published with the Page:

```sh
{{CAMOX_CMD}} pages publish --path /pricing --no-layout
```

Publish only after the user asks or approves, not automatically after editing a draft.

### Unpublish or discard drafts

Remove a Page from live without deleting its draft:

```sh
{{CAMOX_CMD}} pages unpublish --path /pricing
```

Reset a draft to its current live snapshot without changing live:

```sh
{{CAMOX_CMD}} pages discard-changes --path /pricing
```

Both commands accept exactly one of `--id` or `--path`. Discarding fails if the Page has never been published.
