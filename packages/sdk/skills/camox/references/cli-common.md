# Camox CLI common guidance

Use the Camox CLI for CRUD operations on Pages, Block instances, Layout assignments, metadata, drafts, and published content. Use the code references instead when changing Block Definitions or Layout Definitions in `src/blocks/` or `src/layouts/`.

If a change should be visible without a code deployment, it is usually a CLI content operation. Some requests require both code and CLI work: define the new type first, wait for the dev server to discover it, then create or assign its content through the CLI.

## Run the installed CLI

Detect the package manager from the closest `package.json#packageManager` or lockfile, then use its local Camox binary:

| Package manager | Command      |
| --------------- | ------------ |
| pnpm            | `pnpm camox` |
| Bun             | `bunx camox` |
| npm             | `npx camox`  |

In the examples below, replace `{{CAMOX_CMD}}` with that command.

## Discover the current command surface

Before a write, verify the relevant subcommand's `--help` unless already checked for the installed version in this session:

```sh
{{CAMOX_CMD}} pages create --help
```

Use root or group help only to discover unfamiliar commands. Reuse verified help within the session; recheck if the installed version changes. Installed help overrides these examples—do not guess commands or flags.

## Draft-first workflow

By default, reads and writes operate on the draft in the current developer's isolated dev Environment. Make content changes in draft, summarize them for review, and publish only after the user asks or approves.

- Omit `--live` while editing. `--live` only reads the published snapshot.
- Omit `--production` unless the user explicitly asks to operate on the production Environment.
- Publishing a draft and replicating an Environment are different operations. Read the Environment reference before using `env push` or `env pull`.

## Write grounded content

Before writing Content:

1. Inspect existing Pages, Blocks, and Block type descriptions to learn the site's voice, positioning, names, and factual claims.
2. Use facts and copy supplied by the user. Research external facts with an available retrieval tool; ask when a material fact cannot be established.
3. Never invent filler copy, statistics, testimonials, company details, asset filenames, or URLs.
4. Leave `File`, `Embed`, or `Image` values empty when no real asset is available, and tell the user what remains to be supplied.

After writes, report the affected Pages and Blocks and the notable content or structural changes.
