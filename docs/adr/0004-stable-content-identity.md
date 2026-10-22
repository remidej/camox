# Stable content identity

Drafts (ADR 0003) need every piece of content to keep the same identity in Live and in every draft that changes it, so a draft can be compared with Live and applied to it. Today most content uses integer autoincrement keys that push and pull renumber, then rewrite everywhere they appear inside content. We give each content entity (page, block, repeatable item, file, collection record) one UUIDv7, minted when it is first created in a draft and kept for good. Definitions (block definitions, layouts, collections) are identified by the name code gives them, within a project. Integer ids disappear from content, the API, the CLI, and agent tools; only projects keep theirs, as an internal key.

## Considered Options

- **Add a stable column next to the integer keys.** It's a smaller diff, but every foreign key, content marker, and API would have to say which of the two ids it means, and integers would still differ per row.
- **UUIDv4**, already used for collection records and comments. UUIDv7 is time-ordered for the same cost, and with no users yet we regenerate the existing v4 ids instead of carrying two formats.
- **Prefixed short ids** (`blk_…`). They're easier for agents to tell apart, but need a generator and a prefix registry. Accepting only UUIDv7 already turns a wrong id into an immediate validation error.

## Consequences

- An entity's identity is not its storage row's key: how a draft's version of an entity is stored and keyed is left to how drafts store their changes.
- Ids inside content keep their shapes and hold entity ids: `_fileId`, `camox:page:<id>` text links, `{ type: "page", pageId }` link fields, `_itemId` patch handles, comment targets, and references to collection records. Anything pointing at a definition uses its name, so a page names its layout and a collection record names its collection.
- A synced block's shared content is one entity identified by its definition's name, and its repeatable items have ordinary ids shared by every placement. Each draft can hold its own version of that content. `sync_key`, which only matched copied items across placements, goes away.
- Ids are never reused, and undoing a deletion brings an entity back with its original id, so links to it work again.
- The server mints ids, but create endpoints may accept a client-minted UUIDv7, for optimistic inserts. The API only accepts UUIDv7.
- Migrating `apps/landing` gives its content fresh UUIDv7s, including its existing UUIDv4s, and rewrites every id stored in content. See [Drafts start on a fresh database](0013-drafts-start-on-a-fresh-database.md).
- A project's integer stays an internal key: foreign keys and project rooms use it. Each project also has a permanent Project ID, a lowercase UUIDv7 given when it is created, which is what code and the platform name it by ([#436](https://github.com/remidej/camox/issues/436)): a website's `camox()` config, and the Worker and Artifacts repo self-serve project creation names after it ([#423](https://github.com/remidej/camox/issues/423)). Its Project Slug is only an address. The API only accepts the lowercase form, so a Project ID always matches the Worker named after it.
