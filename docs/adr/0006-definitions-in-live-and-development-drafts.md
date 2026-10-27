# Definitions live in Live and in development drafts

Partly superseded by [Drafts carry code](0020-drafts-carry-code.md): any draft that changes code also holds its own definitions, synced from its preview.

Environments used to hold their own copy of every definition: a release synced the production environment, and dev mode synced `dev:<email>`. Drafts (ADR 0003) remove environments, so definitions need a new home. Live holds the released definitions, and each development draft holds the complete set synced from its owner's local code. Regular drafts have no definitions of their own and read Live's. Definition rows are stored like content (ADR 0005): a Live row has no draft, and a development draft's row carries its draft's id. Every reader of definitions, from server validation to AI tools and the CLI, takes them from the draft it works in, falling back to Live.

## Considered Options

- **A development draft stores only the definitions that differ from Live**, like content. Dev mode syncs the whole set anyway, so an overlay would need diffing and tombstones at every sync for no benefit, and reading a draft's definitions would become a merge.
- **Key development drafts by git branch.** Parallel checkouts would stop overwriting each other's definitions, but every branch would leave a draft behind that nothing cleans up, and the localhost studio would need a list to manage them. Adding a branch to the key later doesn't break existing development drafts, so v1 keeps one per member.

## Consequences

- Each member has one development draft per project, created by dev mode's first sync after login and visible only to its owner. Without a login, dev mode keeps redirecting to `/dev-authorize`, since local code can't render Live's definitions. The localhost studio works only in that draft: no Live, no regular drafts.
- Several checkouts of the same developer share one development draft, and the last one to sync sets its definitions.
- Dev mode replaces the draft's whole definition set on every sync. It never migrates content or rejects a change because content exists, collections included. Content the sync seeds, such as a layout's declared blocks, becomes draft rows. Live content shows through under local definitions it wasn't shaped for, the same problem a release creates for open drafts. See [Content outlives its definitions](0007-content-outlives-its-definitions.md).
- A release syncs definitions to Live and is the only writer of Live besides publishing: it inserts content its definitions declare that doesn't exist yet, deletes orphaned layout-only blocks, and bumps `version` so open drafts see a conflict.
- A development draft can be published only when its definitions match Live's: the same names, and the same schema hash for each. The hash covers block content and settings schemas, the synced and layout-only flags, layout kind, and collection content schemas; titles, descriptions and defaults don't count. Collection records never block publishing, unlike push.
- Publishing or deleting a development draft empties its content and keeps the draft and its definitions. Deleting replaces pull; publishing replaces push but applies only what the draft changed.
- With the developer's session, the CLI works only in their development draft. See [The CLI works only in development drafts](0010-the-cli-works-in-development-drafts.md). No command or tool writes definitions; only dev mode and releases sync them.
