# Localizations share their original's identity

Every locale gets its own copy of each page, block, repeatable item, synced block's shared content and collection record, and Camox keeps those copies translated. Content points at other content by id all the time: references, reference lists, page links, `camox:page:<id>` text links, placements. A localization keeps the id of its original (ADR 0004) and adds its locale, so an entity is identified by its id and its locale. Content written in one locale keeps working in every other: a German block linking to the pricing page resolves to the German pricing page, and a German article list resolves to German records, with nothing rewritten.

## Considered Options

- **Each localization gets its own id and a link to its original.** Every reference and link inside a copy would have to be rewritten to the copy's locale on creation, and kept rewritten whenever the original changes. Missing a rewrite sends a German visitor to the English site.

## Consequences

- An id is unique within one locale of Live or of a draft, not within Live or a draft.
- Content that exists in only one locale, such as a block added to the German page by hand, has an id that exists only in that locale.
- Each locale's pages are a separate path space under its prefix, so a duplicate path is a blocker within a locale only (ADR 0009).
- A localization removed on purpose has to stay removed when its original next changes, but deleting it leaves nothing on Live (ADR 0008). Live keeps a record that the entity is excluded from that locale, and the translation job skips it.
- References, links and reference lists resolve in the locale being rendered. Query-backed reference lists query that locale's records.
