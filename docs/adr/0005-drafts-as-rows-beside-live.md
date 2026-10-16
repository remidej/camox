# Drafts are rows beside Live

A draft stores only what it changes, on top of Live (ADR 0003), and every entity keeps one id across Live and drafts (ADR 0004). Today Live is a JSON snapshot that each page and layout points to, and the editable rows are the single draft. We store Live and every draft in the same content tables instead: a Live row has no draft, and a draft row carries its draft's id. The first change a draft makes to an entity copies that whole entity into the draft. Reading a draft takes this draft's row where there is one and the Live row otherwise. Publishing becomes a few set-based statements per table, as D1 requires for an atomic publish. See [Publishing a draft](0009-publishing-a-draft.md).

## Considered Options

- **Overlay tables per content table** (`draft_blocks`, …). The reads are the same, but the schema is doubled and every column change has to be made twice.
- **A change log replayed on read.** Every read and every conflict check pays for folding the log, and v1 needs nothing a log offers.
- **Snapshot documents per draft**, like today's checkpoints. Reference checks would keep parsing JSON on every evaluation, and publishing couldn't be set-based.
- **Copying the whole page on first change.** A draft would freeze its pages, hiding blocks other drafts publish to them and deleting those blocks when it publishes. Copying per entity keeps ADR 0003's promise that untouched content shows the latest Live.

## Consequences

- Live is plain rows, read without parsing JSON. Checkpoints and revisions are dropped; see [Live keeps no history in v1](0008-live-keeps-no-history.md).
- A Live row's `version` counts the changes made to it, since only publishing and releases write Live (see [Definitions live in Live and in development drafts](0006-definitions-in-live-and-development-drafts.md)). A draft copy records the version it started from (`base_version`), or none if the draft created the entity. A conflict is a Live version that moved past the base, or a Live entity that is gone.
- A deletion is a tombstone row in the draft. Deleting a parent tombstones only the parent, and publishing deletes its descendants too. A descendant published to Live after the tombstone was written counts as a conflict, so Live rows also record when they were published.
- A synced block's shared content is a row per definition name, in Live and in each draft that changes it. It owns its repeatable items, and placements of a synced definition hold no content.
- Content tables no longer have foreign keys to each other, because an id is unique only within Live or within one draft. The app and publish validation enforce those relationships. Draft rows cascade from their draft, so discarding a draft is one delete.
- A change that rewrites columns on other entities copies those entities too: renaming a page's path copies every descendant page whose full path changes, and moving a block copies its content along with its position.
- Fractional positions from different drafts can collide, so entities with the same position are ordered by id.
- Inside one draft the last write wins. There is no edit counter on draft rows.

## Research

- [D1 limits for publishing](../research/d1-limits-for-publishing.md): why publishing has to be set-based statements in one batch.
- [Prior art for parallel content changes](../research/prior-art-parallel-content-changes.md): whole-item copies over Live, and recording each copy's base version to detect conflicts.
