# Camox merges localization conflicts

ADR 0009 doesn't merge: a draft's version of everything it changed replaces Live's once the editor confirms each conflict. With every locale translated by Camox (ADR 0015), two drafts changing the same source both change its localizations, so publishing the second would show a conflict per locale, about content nobody in it wrote, and overwrite hand edits published to Live's localizations in between. For localizations, ADR 0009 is amended: a localization the draft changed that Live also changed since isn't a conflict. Camox merges it with Live's before the draft publishes, and only default-locale conflicts are shown and confirmed as before.

The merge is a translation job, so it shows as translating and publishing waits for it like any other. It merges three ways, field by field, as translation jobs do (ADR 0015): from Live's bookkeeping, it follows what the draft's source changed into Live's localization, keeping Live's hand edits, in code where the changes don't overlap and with the AI merge where they do. It then puts back the draft's own hand edits to the localization, and the draft's copy counts as copied from Live's current version, so it stops being a conflict for real and the guard at publishing stays unchanged. A Live change after the merge makes it a conflict again.

## Considered Options

- **Hide localization conflicts from the preview and overwrite Live's.** Hand edits published to Live's localizations would be lost without anyone being told.
- **Merge when the publish preview opens.** The preview would write, and a merge the model can't make would be requested again on every refresh. Instead, publishing a draft requests merges in the other open drafts that copied the localizations it changed: once per Live change, and usually done before anyone opens the preview.

## Consequences

- The localization follows the draft's source, also where a default-locale conflict is confirmed: confirming the draft's source gives every locale its translation.
- Where the draft and Live hand-edited the same field of a localization, the draft's edit wins, as confirming a conflict would.
- A localization the draft only edited by hand was never translated in the draft, so nothing tells its hand edits from what Live held when the draft copied it. It stays a conflict, confirmed as in ADR 0009, as does a localization Live deleted or the draft deletes.
- A merge the model fails leaves the conflict to confirm.
