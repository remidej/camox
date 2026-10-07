# Context-specific field builders

Definitions declare fields through callbacks that receive a builder for their context: `content: (field) => ({ ... })`, `settings: (setting) => ({ ... })`, and a collection's `content: (field) => ({ ... })`. This replaces a single global, TypeBox-styled `Type.*` namespace. Each builder only offers the kinds its context accepts: block and repeatable item content has no `enum` or `boolean`, settings have nothing else, and collection records (which have no settings) accept `boolean` and `enum` but not repeaters, links, icons or references. A misplaced field is then a missing property on a named builder type, not a long schema mismatch, and autocomplete only lists legal fields.

Builders return opaque field descriptors, so the public API no longer exposes the schema library. Replacing TypeBox (for example with Effect Schema) is now an internal change.

## Considered Options

- **Keep `Type.*`.** The PascalCase, TypeBox-like names were meant to help LLMs write definitions, but the skills make that unnecessary, and one namespace can't express per-context rules.
- **Separate imports with type constraints** (`import { content, setting }`): this works, but needs one namespace per context, and a misplaced field fails with a type mismatch on the whole object instead of a missing property.
- **Short parameter names** (`f`, `s`): `s` already names the settings proxy in `toMarkdown`. Definitions are mostly read and written by agents, often from partial context, so `field` and `setting` name their context wherever they appear.

## Consequences

Callback parameters are context-sensitive for TypeScript inference. Any option typed against the inferred content shape must be checked through the callback's return type rather than directly. For example, a collection's `label` is validated as a string field in `content`'s return type.
