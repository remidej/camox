# Camox CLI

## Runtime lookup and monorepos

Runtime-backed commands (`status`, `pages`, `blocks`, `layouts`, `files`,
`publish`, `discard`, `preview`, and `logout`) accept `--cwd PATH`:

```sh
camox pages list --cwd apps/site
camox status --cwd apps/site
camox files upload --cwd apps/site --file ./hero.webp --alt "Product screenshot"
```

The CLI searches for `node_modules/.camox/runtime.json` starting in that directory
and walking upward. Without `--cwd`, lookup starts in the shell's current directory.
There is no workspace or child-directory discovery. Run the app's dev server or
build once to generate its runtime file.

Relative `--cwd` paths resolve against the shell's current directory. This option
only affects runtime lookup: other paths, such as `--file ./hero.webp`, still
resolve against the shell's current directory. Missing or non-directory paths fail
instead of falling back to the shell's directory.

## Your development draft

Every command reads and writes your development draft: it shows Live wherever
it changes nothing, and publishing it lands on Live. No command takes a draft
flag. Dev mode creates the draft on its first sync after `camox login`, so run
your site locally once (e.g. `pnpm dev`) before using the CLI; until then,
commands fail with `NO_DEVELOPMENT_DRAFT`.

Agents in parallel worktrees share their developer's development draft, and
publish or discard it together.

## Publishing and discarding

```sh
camox status                    # whether your development draft exists, and how many changes it holds
camox publish                   # what publishing would do, with a token
camox publish --confirm TOKEN   # publish to Live
camox discard                   # empty your development draft (asks first; --yes skips the question)
```

`camox publish` lists, in order:

- **Blockers**, which prevent publishing until they're fixed in the draft. They
  include definitions that differ from Live's: your local code changed a block,
  layout or collection, and only a release (`camox release`) can ship it to Live.
- **Conflicts**: content Live changed or deleted since your draft changed it,
  with who published it and when. Publishing overwrites Live's version.
- **Lost changes**, which publishing drops because what they belong to is gone.
- **Warnings**: the same problems already on Live, which don't block.
- **Changes**: everything your draft creates, changes or deletes.

The token records the conflicts the list showed. `camox publish --confirm TOKEN`
publishes the whole draft, which then stays open, emptied. If Live changed since
the list was printed, nothing is published: the command prints the new list and
token, fails with `CONFLICTS_CHANGED`, and you review it before confirming again.

`camox discard` empties your development draft without touching Live. It asks
for confirmation in a terminal; elsewhere it fails with `CONFIRMATION_REQUIRED`
unless you pass `--yes`.

## Authenticated local preview

CLI login does not sign in a fresh browser. To verify writes in your development draft:

```sh
camox preview --url http://localhost:3000/about --json
camox preview --cwd apps/site --url http://localhost:3000/about --json
```

Open the returned `url` in the browser you use for verification. Wait for
`[data-camox-preview="ready"]`, which identifies the project and your
development draft after authenticated rendering. Errors appear as
`[data-camox-preview="error"]`; expired or consumed links require a fresh command.
The CLI and SDK must both support the preview handoff.

The URL transfers your signed-in session: treat it as a credential, do not share
or commit it, and use it within three minutes. Only HTTP(S) loopback URLs are
accepted. The destination must match the CLI's project and backend. There is no
automatic default-browser opening.
The local dev server must already be running.

## Page SEO

Use `pages get` to read metadata and `pages set-seo` to edit it:

```sh
camox pages get --path /about --json
camox pages set-seo --path /about --meta-title "About us" --meta-description "Meet the team."
# Page and block IDs are UUIDv7s; anything else is rejected.
PAGE_ID=0199f1c2-7b3e-7a10-9c4d-5e6f7a8b9c0a
camox pages set-seo --id "$PAGE_ID" --meta-description ""
camox pages set-seo --id "$PAGE_ID" --ai-seo on
camox pages set-seo --id "$PAGE_ID" --ai-seo off
```

- `set-seo` requires exactly one of `--id` or `--path` and at least one of
  `--meta-title`, `--meta-description` or `--ai-seo`. An empty meta title blocks
  publishing.
- The meta title and description are one group: both generated or both manual.
  Writing either field makes **both** manual, keeping the current value of the
  other. Manual metadata cannot be combined with `--ai-seo on`.
- `--ai-seo off` keeps current metadata as manual. `--ai-seo on` schedules asynchronous
  generation; the returned page contains current values, not necessarily generated
  values. Use `pages get` to inspect them later.
- Changes are visible in your development draft right away, and reach Live
  when you publish it.
- Commands support `--project SLUG` and `--json`, with structured JSON
  output/errors.

See `camox pages update --help` for options and examples.

## Shared navigation and footer content

`pages get` shows page-owned blocks. To find layout-owned blocks:

```sh
camox layouts list
camox layouts get --layout-id default --json
BLOCK_ID=0199f1c2-7b3e-7a10-9c4d-5e6f7a8b9c0b
camox blocks get --id "$BLOCK_ID"
camox blocks edit --id "$BLOCK_ID" --content '{"title": "Updated title"}'
```

A layout is identified by the name its code gives it: the `layoutId` from
`layouts list`, which is also a page's `layoutId`. `layouts get` returns
`blocks` with IDs, types, layout slot, and content, along with ordered
`layout.beforeBlockIds` and `layout.afterBlockIds`. Use a returned block `id`
with `blocks get` and `blocks edit`, inspecting its schema and current content
before editing.

Commands accept `--cwd`, `--project`, and `--json`.
Keep the project consistent when using discovered IDs.
Editing a shared layout block changes it for all pages using that layout.

## Media

Run `camox login` and start your project's dev server (or build once) so the CLI
can discover the project's runtime configuration.

```sh
# Upload a local file with manual alt text.
camox files upload --file ./hero.webp --alt "Product screenshot" --json

# Download a remote file and store a copy in Camox.
camox files upload --url https://example.com/hero.webp --alt "Product screenshot"

# Optionally override the uploaded filename.
camox files upload --url https://example.com/download --filename hero.webp --ai-metadata off

# Inspect the returned ID and URL; use the ID in your block's media field.
# File IDs are UUIDv7s; anything else is rejected.
camox files list
FILE_ID=0199f1c2-7b3e-7a10-9c4d-5e6f7a8b9c0d
camox files get --id "$FILE_ID"

camox files update --id "$FILE_ID" --filename hero.webp
camox files update --id "$FILE_ID" --alt "Updated description"
camox files update --id "$FILE_ID" --alt ""
camox files update --id "$FILE_ID" --ai-metadata on

# Replace the underlying file everywhere it is referenced, preserving its ID.
camox files update --id "$FILE_ID" --file ./new-hero.webp
camox files update --id "$FILE_ID" --url https://example.com/new-hero.webp

# Replace content and override metadata together.
camox files update --id "$FILE_ID" --file ./new-hero.webp --filename hero.webp --alt "New screenshot"
```

- Upload requires exactly one of `--file` or `--url`. URLs are copied, not linked.
- Alt text and filename are one group: both generated or both manual. `--alt`
  (even an empty string) makes both manual, keeping the current filename.
  It cannot be combined with `--ai-metadata on`. Manual edits are protected from
  already-running AI jobs.
- Without metadata flags, raster-image uploads use automatic metadata. Other
  file types do not. AI may update both the filename and alt text asynchronously.
- `--ai-metadata on` schedules generation for raster images; success does not mean
  generation has completed. Use `files get` to inspect the current record.
- Update requires at least one of `--file`, `--url`, `--filename`, `--alt` or
  `--ai-metadata`. `--file` and `--url` are mutually exclusive; without either,
  only metadata changes. Renaming alone preserves the file ID and URL and makes
  both alt text and filename manual.
- Replacing content preserves the file ID and all `_fileId` references in your
  development draft. The URL changes to avoid stale caches. Direct URLs in
  stored block/repeatable-item content are migrated within that draft;
  URLs hardcoded outside Camox cannot be rewritten.
- Replacements preserve omitted alt text and AI settings. The filename defaults
  to the new source filename; `--filename` overrides it. Binary metadata and
  explicit metadata changes are saved together. If AI remains enabled, raster
  replacements schedule generation on the original file ID; other types skip
  generation. Disable AI to prevent future automatic renaming or alt changes.
- Files are shared assets: replacing one affects every reference
  to it in your development draft.
- Failed replacements leave the original file unchanged and remove the unused
  uploaded binary. After a network timeout, use `files get --id ID` before retrying
  because the server may already have completed the operation.
- All commands support `--project SLUG` and `--json`. IDs are scoped to the
  selected project.
- Uploads return the stored file record, including `id`, `url`, `mimeType`, `alt`,
  and `aiMetadata`. Output is JSON; errors are structured JSON on stderr.
- Files are limited to 100 MiB. URL downloads allow at most five redirects and
  have a two-minute timeout; uploads have a separate two-minute timeout.
  Downloads stream through a temporary file that is removed afterward.
- Only HTTP(S) URLs without embedded credentials are supported. Signed query
  URLs work and are not included in download errors. Camox credentials are never
  sent to the source URL. Remote authentication flags and batch uploads are not
  supported.

See `camox files --help`, `camox files upload --help`, and
`camox files update --help` for command options.
