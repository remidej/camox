# Drafts start on a fresh database

Drafts change every content table (ADR 0005), and little has to survive the change: only Live content, only for `apps/landing`, with no history, drafts or development environments. Migrating in place would rebuild most tables, tear down the reference views and triggers, and rewrite ids inside content JSON in SQL. Instead, a new D1 database starts from one baseline migration generated from the new schema, and a one-off script copies into it what has to survive. The 34 migrations before it, and the database they built, are deleted.

## Considered Options

- **Migrate in place.** SQLite can't drop foreign keys without rebuilding tables, and SQL has no good way to mint UUIDv7s or rewrite ids inside JSON. The drizzle snapshots have also drifted from the real tables.
- **Keep the old database for a rollback.** Nothing would read it, and it would wait to be forgotten. A migration that goes wrong is fixed forward.
- **Migrate every project's Live.** Only one other project has a published page, and its owner doesn't need it kept.

## Consequences

- The script runs locally: it reads a `wrangler d1 export` of the old database and writes SQL, which is imported into the new database before the merge that deploys drafts. It lives only on the drafts branch and is deleted before that merge, so neither it nor today's remap code reaches `main`.
- Live is what a logged-out visitor sees: blocks and items from each page's and layout's published checkpoint, synced content from its published data, and a page's path, layout and SEO from its current row. Pages never published, unpublished edits and development environments are dropped.
- Landing's content gets fresh UUIDv7s (ADR 0004), and every id inside it is rewritten. An id that points at nothing is stored empty, as it renders today, and the script lists each one.
- Landing's definitions, file rows, generated values (ADR 0012) and comments whose anchor survives come along. A file keeps its R2 key, so its URL doesn't change. Where an AI flag was on or unset, the current value becomes the generated one and the manual value is `null`; where it was off, the value becomes manual.
- The better-auth tables and `projects` are copied as they are, so accounts, sessions, organizations and deploy tokens keep working. Other projects start empty and get their definitions back from their next release.
- Cutover is: stop editing, export, run the script, import, merge. The site is down for the few minutes between the API's deploy and landing's, and a sign-up in that gap is lost.
- Before writing, the script checks that every id resolves and that the counts match. After the deploy, each page's text, links and file URLs are compared with before, auth and project row counts with the old database's, and signing in to the studio has to work. Only then is the old database deleted.
- R2 objects nothing points at anymore stay where they are, and the AI job queue drains while editing is stopped.
