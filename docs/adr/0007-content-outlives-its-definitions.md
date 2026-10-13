# Content outlives its definitions

A release changes definitions under content that was shaped for the old ones, in Live and in every open draft, and a development draft shows Live content under local definitions it wasn't shaped for (ADR 0006). We never migrate content to fit its definitions. Stored content keeps whatever shape it was written in, and one step in the API conforms it to the definitions in effect for the draft being read before anything returns it. Code is the source of truth, so content never blocks a release.

## Considered Options

- **Migrate automatically at release time**, with the same rules reads apply. It is deterministic, but it adds no capability over conforming on read: a rename still looks like a removal plus an addition. It costs more instead: a release would have to rewrite drafts, rewrite many rows within D1's batch limits, and a code rollback would find its removed fields' content gone. Development drafts would still need lenient reads, since their definitions are never released.
- **Migrations written in code**, keyed by the schema a row was written under. They are the only way to handle renames and conversions, but they are user code that would have to run in the build against Live and every draft, without atomicity, against concurrent edits, and with down-migrations for rollbacks. Out of scope; nothing is stored to prepare for them.
- **Flag drafts that a release affected.** Content whose definition is gone already shows in the studio, and the quiet changes (a field removed, an enum value dropped) are what the developer meant.

## Consequences

- Conforming happens in one place in the API, on every read that returns content, including Markdown and AI tools. It drops unknown keys, fills missing fields with their defaults, replaces values of the wrong kind with the default, and leaves out repeatable items under a removed repeater. Everything after it gets content typed exactly by its definition, with no checks for stale shapes. Collection fields without a default fall back to an empty value of their kind.
- Writes keep merging patches into stored content as is, so stale keys stay stored, invisible. A definition that comes back finds its content again.
- Publishing doesn't check content against definitions, for blocks or collection records. Writes still validate the incoming patch.
- Content whose definition is gone stays stored and comes back with its definition:
  - Blocks of a removed block definition render nothing. In edit mode the studio shows a placeholder that can only be deleted, in a draft.
  - Pages of a removed layout, or of a layout that is no longer curated, are not served. The studio lists them as needing a layout, to be moved or deleted in a draft.
  - Records of a removed collection are kept and hidden.
- A singleton whose URL collides with a curated page serves that URL. The studio flags the curated page as shadowed.
- Placements of a block definition that became layout-only keep rendering. Conforming checks shape, not where a block is placed.
- A release writes only Live, including when a definition becomes synced or stops being synced:
  - Becoming synced, Live's shared content is copied from the most recently published placement, or the defaults if there is none, and the placements' own content is cleared.
  - No longer synced, every Live placement gets a copy of the shared content, which is then deleted.
  - Drafts holding content that no longer applies (a placement's own content, or a draft's version of shared content) keep it unread. The release bumps the Live `version` of what it changed, so those drafts see a conflict.
- Dev mode applies the same synced and no-longer-synced rules to the development draft, writing draft rows instead of Live rows.
