# Camox CLI

## Page SEO

Use `pages get` to read metadata and `pages update` to edit it:

```sh
camox pages get --path /about --json
camox pages update --path /about --meta-title "About us" --meta-description "Meet the team."
camox pages update --id 42 --meta-description ""
camox pages update --id 42 --ai-seo on
camox pages update --id 42 --ai-seo off
camox pages get --path /about --live
camox pages publish --path /about
```

- Updates require exactly one of `--id` or `--path` and at least one update field.
  Omitted fields are preserved; empty strings clear metadata.
- Setting either metadata field disables automatic SEO for **both** fields.
  Manual metadata cannot be combined with `--ai-seo on`.
- `--ai-seo off` preserves current metadata. `--ai-seo on` schedules asynchronous
  generation; the returned page contains current values, not necessarily generated
  values. Use `pages get` to inspect them later.
- Changes affect the draft only. Publish separately to update live metadata.
  `pages get --live` reads the published snapshot; without it, reads use the draft.
- Commands support `--project SLUG`, `--production`, and `--json`, with the usual
  development-environment default and structured JSON output/errors. `--production`
  selects the environment; it does not publish the draft.

See `camox pages update --help` for options and examples.

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
camox files list
camox files get --id 123

camox files update --id 123 --filename hero.webp
camox files update --id 123 --alt "Updated description"
camox files update --id 123 --alt ""
camox files update --id 123 --ai-metadata on

# Replace the underlying file everywhere it is referenced, preserving its ID.
camox files update --id 123 --file ./new-hero.webp
camox files update --id 123 --url https://example.com/new-hero.webp

# Replace content and override metadata together.
camox files update --id 123 --file ./new-hero.webp --filename hero.webp --alt "New screenshot"
```

- Upload requires exactly one of `--file` or `--url`. URLs are copied, not linked.
- `--alt` disables AI metadata, including when its value is an empty string.
  It cannot be combined with `--ai-metadata on`. Manual edits are protected from
  already-running AI jobs.
- Without metadata flags, raster-image uploads use automatic metadata. Other
  file types do not. AI may update both the filename and alt text asynchronously.
- `--ai-metadata on` schedules generation for raster images; success does not mean
  generation has completed. Use `files get` to inspect the current record.
- Update requires at least one of `--file`, `--url`, `--filename`, `--alt` or
  `--ai-metadata`. `--file` and `--url` are mutually exclusive; without either,
  only metadata changes. Renaming alone preserves the file ID, URL and AI setting.
- Replacing content preserves the file ID and all `_fileId` references in the
  selected environment. The URL changes to avoid stale caches. Direct URLs in
  stored block/repeatable-item content are migrated within that environment;
  URLs hardcoded outside Camox cannot be rewritten.
- Replacements preserve omitted alt text and AI settings. The filename defaults
  to the new source filename; `--filename` overrides it. Binary metadata and
  explicit metadata changes are saved together. If AI remains enabled, raster
  replacements schedule generation on the original file ID; other types skip
  generation. Disable AI to prevent future automatic renaming or alt changes.
- Files are shared assets, not page drafts: replacing one affects every reference
  to it in the selected environment. No page publish step is required.
- Failed replacements leave the original file unchanged and remove the unused
  uploaded binary. After a network timeout, use `files get --id ID` before retrying
  because the server may already have completed the operation.
- All commands support `--project SLUG`, `--production`, and `--json`. The default
  environment is `dev:<your-email>`, not production. IDs are scoped to the selected
  project and environment.
- Uploads return the stored file record, including `id`, `url`, `mimeType`, `alt`,
  and `aiMetadataEnabled`. Output is JSON; errors are structured JSON on stderr.
- Files are limited to 100 MiB. URL downloads allow at most five redirects and
  have a two-minute timeout; uploads have a separate two-minute timeout.
  Downloads stream through a temporary file that is removed afterward.
- Only HTTP(S) URLs without embedded credentials are supported. Signed query
  URLs work and are not included in download errors. Camox credentials are never
  sent to the source URL. Remote authentication flags and batch uploads are not
  supported.

See `camox files --help`, `camox files upload --help`, and
`camox files update --help` for command options.
