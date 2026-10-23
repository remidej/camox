# Publishing a draft

Publishing applies a whole draft to Live in one D1 `batch()`, with a fixed number of set-based statements per table (ADR 0005), and deletes the draft in the same batch, or empties it for a development draft (ADR 0006). v1 doesn't merge, so the draft's version of everything it changed replaces Live's after the editor confirms. Publishing is also where problems get caught before they reach Live. Agents will run most publishes, and they can fix whatever they're told about, so friction here is cheap and the aim is no problems on Live. Anything the draft can fix is a blocker: publishing waits until it's fixed in the draft. What the draft can't fix, conflicts and lost changes, is confirmed instead.

## Considered Options

- **Block only on duplicate paths**, and publish dangling references to read as empty. It keeps every publish going, but Live then shows broken references that nobody was told about, when an agent could have fixed them in the draft.
- **Block on conflicts or lost changes.** Without merging, the only way out of a conflict is to overwrite, and lost changes can't even be seen in the draft to fix them.
- **Block on every problem Live would contain after publishing.** One release that removes a collection would block every publish until someone cleans up content the draft never touched.
- **Overwrite a duplicate path**, or add a suffix to it. The first deletes a page the draft never touched; the second quietly changes a URL.
- **Compute conflicts continuously** for every open draft. It recomputes on every Live change for a hint the publish dialog already gives.

## Consequences

- Blockers are problems the publish would create:
  - A duplicate path: a page path the draft creates or renames to that Live or another of the draft's pages already uses, or two records sharing the value their record pages are found by. The draft flags it as soon as it appears.
  - Definitions that differ from Live's, in a development draft (ADR 0006).
  - An empty required reference, image, or file in content the draft changed.
  - A dangling reference the publish would create: in content the draft changed, a reference, reference-list entry, page link, or file that points at nothing; or Live content pointing at something the draft deletes. The fix for untouched Live content is to edit it in the draft.
  - A value of the wrong kind for its definition in content the draft changed, which reading would replace with the default (ADR 0007).
  - A file the draft adds or replaces whose stored bytes are missing.
  - A file the draft replaces with a type that a field using it doesn't accept, even in untouched Live content.
  - A page the draft creates or changes with no meta title, manual or generated (ADR 0012). While generation is pending it's a warning instead, so a model outage never stops publishing.
- The same problems already on Live, such as references a release left dangling, are warnings. Reads still treat a missing target as empty: a reference or reference-list entry to a missing record is left out, and a link to a missing page renders as plain text.
- The confirmation lists, in order: blockers, which disable publishing; conflicts, each with who published Live's version and when; changes that will be lost; warnings; and the draft's changes. There is one Publish button and no choice per conflict. Blockers and conflicts are computed when the dialog opens, and `camox publish` prints the same list (ADR 0010).
- Localizations are the exception: Camox merges a localization the draft changed with Live's before publishing, instead of showing a conflict (ADR 0016).
- Moving a block copies its content (ADR 0005), so a draft that only moved a block overwrites text another draft published to it. The confirmation shows it as a conflict.
- The client sends back the conflicts it showed, as entity ids and Live versions. The server recomputes blockers, and the batch's first statement aborts it if the current conflicts differ; the dialog then shows the new ones. Releases bump versions too, so a release between confirming and publishing is caught the same way.
- An entity Live deleted after the draft copied it comes back with its id and the draft's content. A changed entity whose parent exists neither in Live nor in the draft is dropped and listed as lost: Live keeps no copy of the parent to restore (ADR 0008).
- Deleting a parent also deletes Live descendants published after the deletion was drafted; they are listed as lost.
- A publish whose outcome is unknown, such as after a lost connection, can be retried: a draft that is gone, or a development draft that is empty, means it was already published or discarded. Publishing an empty draft does nothing.
- Other open drafts are untouched: their untouched content shows the new Live, and what they share with the published draft becomes a conflict when they publish. Editors inside the published draft are switched to Live.

## Amendment: the studio's review

The studio's review no longer shows everything the confirmation lists. It shows blockers, conflicts and lost changes, one card each, then quiet status lines for what's fine or still running: the draft includes everything published to Live, its translations, and the page SEO being written. It leaves out warnings about problems already on Live, which are about Live rather than the draft, and the list of the draft's changes, which a draft overview is to cover instead (#526). `camox publish` keeps printing the full list, warnings and changes included (ADR 0010), and the preview keeps returning them.
