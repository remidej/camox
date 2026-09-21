# Camox CLI

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
```

- Upload requires exactly one of `--file` or `--url`. URLs are copied, not linked.
- `--alt` disables AI metadata, including when its value is an empty string.
  It cannot be combined with `--ai-metadata on`. Manual edits are protected from
  already-running AI jobs.
- Without metadata flags, raster-image uploads use automatic metadata. Other
  file types do not. AI may update both the filename and alt text asynchronously.
- `--ai-metadata on` schedules generation for raster images; success does not mean
  generation has completed. Use `files get` to inspect the current record.
- Update requires at least one of `--filename`, `--alt` or `--ai-metadata`; omitted
  fields remain unchanged. Renaming preserves the file ID, URL, and AI setting.
  Disable AI metadata to prevent future automatic renaming. Files are shared
  assets, not page drafts.
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

See `camox files --help` and `camox files upload --help` for command options.
