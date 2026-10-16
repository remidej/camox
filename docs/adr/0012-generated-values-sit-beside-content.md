# Generated values sit beside content

Background jobs ask a model for block and item summaries, a page's meta title and description, and a file's alt text and filename, and today write them onto the rows they describe. In a draft, writing to an entity copies the whole entity into it (ADR 0005), and the jobs chain upwards: an item's summary triggers its block's summary, which triggers its page's SEO. So one item edit would copy its block and page into the draft. If another draft then renamed that page and published, this draft's publish would overwrite the rename behind a conflict nobody here caused. Generated values are therefore not content. They are stored beside it, one per entity for Live and for each draft that generated its own, and a draft reads its own value and falls back to Live's, like content. Producing one never copies an entity into a draft, never counts as a change, and never conflicts.

## Considered Options

- **Write generated values into content rows**, as today. Background jobs would create changes and conflicts no one made.
- **Generate only on Live, after publishing.** Drafts would show stale labels and SEO while editing, and Live's SEO would lag every publish, unreviewed.
- **Flags for AI ownership** (`aiSeoEnabled`, `aiMetadataEnabled`) next to the manual values. Every write path has to remember to turn the flag off, and today the CLI's meta setters don't, so the next generation silently overwrites an agent's edit.

## Consequences

- Jobs are keyed by entity, type, and Live or draft. A job whose draft has ended does nothing.
- Publishing copies the draft's generated values over Live's in its batch, so Live gets what was reviewed. It then schedules Live jobs for everything it changed and the parents above it, since another draft may have published to the same page since. These jobs and releases that seed content are the only writers of Live's generated values; only publishing and releases write Live content.
- Development drafts generate values like any draft.
- Manual SEO and file metadata stay content, as nullable values: `null` means the generated value applies. The API keeps each group (meta title with description; alt text with filename) all generated or all manual. Writing any field of a generated group makes the whole group manual, copying the generated values into the fields not written. Making it generated again sets them all to `null`.
- The studio keeps an AI switch per group, derived from the data. Turning it off copies the generated values in, so editing starts from them, and an empty manual value stays possible, for decorative images.
- Jobs skip groups that are manual. The CLI and AI tools set a page's SEO with one command that takes either field or both.
- A page the draft creates or changes with no meta title is a blocker: manual and empty, or generated with nothing generated and no job pending. While a job is pending it's a warning (ADR 0009).
