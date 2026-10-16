# Live keeps no history in v1

Pages and layouts have checkpoints and collection records have revisions, but only publishing ever writes them, and once Live is plain rows (ADR 0005) nothing reads them except a page's "published at / by" and a record's first publish date. We drop both. Publishing replaces the Live rows a draft changes and keeps no copy of what they held, so v1 can't roll back a publish. Live rows record instead when they were first published, when they were last published, and by whom. There are no users yet, so history lost before a later version records it is worth nothing.

## Considered Options

- **A publication log**: one row per publish naming the draft, the publisher, the time, and the entities it changed. Nothing in v1 would read it.
- **The log plus before-images**: each publish also copies the Live rows it overwrites or deletes, in the same batch, so a later version can revert a publish by starting a draft from those copies and publishing it through the usual conflict check. It is the natural next step, and adding it later changes nothing in the model.
- **Rollback in the v1 studio**, on top of before-images.
- **Keep checkpoints and revisions** as per-entity snapshots on publish. Two snapshot formats would stay alive for a UI that doesn't exist.

## Consequences

- A Live row's first publish time doesn't move on later publishes; query-backed reference lists sort by it, so fixing a typo in an old post doesn't reorder the list. An entity created in a draft is first published when that draft is.
- Whole-draft discard is the only undo. Reverting one page, layout, or record to Live inside a draft isn't offered: a page rename copies its descendants into the draft too (ADR 0005), so reverting one entity would mean tracking why each row was copied.
- Deleting a page in a draft and publishing is the only way to take it off Live, and its content is then gone. There is no hidden or unpublished state.
- Files are no longer kept alive by revisions, only by Live and drafts referencing them.
