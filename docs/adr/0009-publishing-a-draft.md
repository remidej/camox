# Publishing a draft

Publishing applies a whole draft to Live in one D1 `batch()`, with a fixed number of set-based statements per table (ADR 0005), and deletes the draft in the same batch, or empties it for a development draft (ADR 0006). v1 doesn't merge, so the draft's version of everything it changed replaces Live's after the editor confirms. Publishing never stops because of what another draft did, except when two pages would share a path: something the editor can fix in the draft, and the only thing whose overwrite would delete an unrelated page.

## Considered Options

- **Block on conflicts, dangling references, or orphaned changes.** A draft would get stuck because of an unrelated publish, with no merging to get it unstuck, and orphaned changes can't even be seen in the draft to fix them.
- **Overwrite a duplicate path**, or add a suffix to it. The first deletes a page the draft never touched; the second quietly changes a URL.
- **Compute conflicts continuously** for every open draft. It recomputes on every Live change for a hint the publish dialog already gives.

## Consequences

- The confirmation lists, in order: duplicate paths, which disable publishing; conflicts, each with who published Live's version and when; changes that will be lost; and the draft's changes, with dangling references as warnings. There is one Publish button and no choice per conflict. Conflicts are computed when the dialog opens.
- Moving a block copies its content (ADR 0005), so a draft that only moved a block overwrites text another draft published to it. The confirmation shows it as a conflict.
- The client sends back the conflicts it showed, as entity ids and Live versions. The batch's first statement aborts it if the current conflicts differ, and the dialog shows the new ones. Releases bump versions too, so a release between confirming and publishing is caught the same way.
- An entity Live deleted after the draft copied it comes back with its id and the draft's content. A changed entity whose parent exists neither in Live nor in the draft is dropped and listed as lost: Live keeps no copy of the parent to restore (ADR 0008).
- Deleting a parent also deletes Live descendants published after the deletion was drafted; they are listed as lost.
- References whose target Live deleted are published as they are. Reads treat a missing target as empty: a reference or reference-list entry to a missing record is left out, and a link to a missing page renders as plain text. This extends the conform step of ADR 0007 to targets.
- A page path that a draft creates or renames to, and that Live or another of the draft's pages already uses, is a duplicate path. The draft flags it as soon as it appears, and publishing is blocked until it's fixed.
- A publish whose outcome is unknown, such as after a lost connection, can be retried: a draft that is gone, or a development draft that is empty, means it was already published or discarded. Publishing an empty draft does nothing.
- Other open drafts are untouched: their untouched content shows the new Live, and what they share with the published draft becomes a conflict when they publish. Editors inside the published draft are switched to Live.
