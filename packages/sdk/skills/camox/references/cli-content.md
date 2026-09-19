# Managing Pages and Blocks with the Camox CLI

Read [cli-common.md](cli-common.md) first. Replace `{{CAMOX_CMD}}` as described there and verify commands with `--help`.

Use these commands for Pages, metadata, Layout assignments, Block instances and their Content, draft review, and publishing. To change Block schemas or rendering, read [Block Definitions](block-definitions.md); to create or change Layout Definitions, follow the code-definition routing in [the Camox skill](../SKILL.md).

## Pages

### Create a Page with an existing Layout

```sh
{{CAMOX_CMD}} layouts list
{{CAMOX_CMD}} pages create --path-segment about --layout-id 39
```

Use `--parent-page-id <ID>` to nest the Page under another Page. Assigning an existing Layout is a CLI content operation; creating or changing a Layout Definition is a code operation.

## Blocks

### Inspect before changing

Look up the Page before creating or moving Blocks so you have its `id`, current Blocks, and any sibling ids. Describe the Block type before constructing Content:

```sh
{{CAMOX_CMD}} pages get --path /
{{CAMOX_CMD}} blocks describe --type hero
```

### Create and position a Block

```sh
{{CAMOX_CMD}} blocks create --page-id 25 --type hero --content '{...}'
{{CAMOX_CMD}} blocks create --page-id 25 --type hero --content '{...}' --position first
{{CAMOX_CMD}} blocks create --page-id 25 --type hero --content '{...}' --before-id 174
{{CAMOX_CMD}} blocks create --page-id 25 --type hero --content '{...}' --after-id 174
```

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

Publish or discard Block changes at the Page level.

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

Do not publish merely because a draft edit succeeded. Summarize the draft and wait for the user to ask or approve publication.

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
