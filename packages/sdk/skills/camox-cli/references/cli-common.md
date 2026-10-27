# Camox CLI common guidance

Use the Camox CLI for CRUD operations on Pages, Blocks, Layout assignments, and metadata. Follow the [`camox` skill](../../camox/SKILL.md) instead when changing Block Definitions or Layout Definitions in `src/blocks/` or `src/layouts/`.

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

## Dev-first workflow

Every command reads and writes the current developer's development draft, never Live. Make content changes there and summarize them for review; they reach Live only when the draft is published (see [CLI Publishing](cli-publishing.md)). Don't publish unless the user asks.

- If a command fails with "run the site locally first", the development draft doesn't exist yet: the dev server creates it on its first sync after `camox login`.

## Verify changes in a browser

CLI credentials and browser sessions are separate. A fresh browser isn't signed in, even when CLI writes succeeded.

1. Start the app's dev server and check `{{CAMOX_CMD}} preview --help`.
2. Generate a handoff for the page you changed:
   `{{CAMOX_CMD}} preview --url http://localhost:3000/about --json`
   (Use the actual port; add `--cwd apps/site` in a monorepo.)
3. Open the returned `url` in your verification browser, not a separate default browser.
4. Wait for `[data-camox-preview="ready"]`. Its text identifies the project and the development draft; the server has loaded authenticated content. `[data-camox-preview="error"]` means verification failed, not that the write failed.
5. Inspect the changed content.

The URL is a single-use sign-in credential valid for three minutes. Do not share, commit, or include it in reports. Generate a new URL if expired or consumed. Only loopback HTTP(S) destinations are supported; previewing a deployed site is intentionally unsupported. The SDK must support this handoff: if the ready marker never appears, check the installed SDK version rather than assuming the write failed. A project or backend mismatch requires correcting `--cwd` or `--url` (or restarting a dev server running under another account).

## Write grounded content

Before writing Content:

1. Inspect existing Pages, Blocks, and Block type descriptions to learn the site's voice, positioning, names, and factual claims.
2. Use facts and copy supplied by the user. Research external facts with an available retrieval tool; ask when a material fact cannot be established.
3. Never invent filler copy, statistics, testimonials, company details, asset filenames, or URLs.
4. Leave `File`, `Embed`, or `Image` values empty when no real asset is available, and tell the user what remains to be supplied.

After writes, report the affected Pages and Blocks and the notable content or structural changes.
