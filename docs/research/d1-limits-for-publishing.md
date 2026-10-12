# D1 limits for publishing

Research for the wayfinder ticket [D1 limits for publishing](https://github.com/remidej/camox/issues/194) on the [Drafts v1](https://github.com/remidej/camox/issues/192) map. Question: can a large draft be applied to Live atomically on Cloudflare D1? Researched 2026-10-12 against Cloudflare and Drizzle primary sources; each page's "last updated" date is noted.

## Answer

Yes, provided publishing is written as **a few set-based statements in one `batch()`**, not one statement per row.

- `batch()` is the only atomic unit D1 offers. Statements run in order, and if one fails the whole batch is rolled back. `BEGIN`/`COMMIT`, savepoints and Drizzle's `db.transaction()` are rejected on D1.
- D1 imposes no limit on statements or payload per batch. Its limits apply to each statement (100 bound parameters, 100 KB of SQL). The 30-second duration limit applies to the whole batch call.
- So the publish should copy a draft's changes with statements like `INSERT … SELECT … WHERE draft_id = ?` and `DELETE … WHERE id IN (SELECT …)`, one or two per table. The number of statements then stays constant however big the draft is, and no statement comes near the parameter limit. If the draft's rows instead had to be sent as parameters, the cap is about `floor(100 / columns)` rows per `INSERT`, or arrays have to go through `json_each(?)`.
- Two things to check by experiment before relying on them:
  - Whether N statements in a batch count as N against the per-invocation query limit (1,000 on Paid).
  - Which SQLite features D1 supports in writes (`UPDATE … FROM`, CTEs in writes).
- Rollback: Time Travel restores the whole database to any minute of the last 30 days. It's a destructive, project-wide safety net, not an "undo this publish" feature.

## D1 limits

Source: [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) (updated 2026-04-21).

| Limit | Value |
|---|---|
| Database size | 10 GB Paid / 500 MB Free (cannot be raised) |
| Queries per Worker invocation | 1,000 Paid / 50 Free |
| SQL statement length | 100 KB |
| Bound parameters per query | **100** |
| String, BLOB or row size | 2 MB |
| Columns per table | 100 |
| Query duration | 30 s, which "also applies to the entire batch call" |
| Simultaneous connections per invocation | 6 |
| Time Travel | 30 days Paid / 7 days Free |

- "Limits for individual queries … apply to each individual statement contained within a batch statement."
- No maximum statement count or payload size per batch is documented.
- "A single query that attempts to modify hundreds of thousands of rows or hundreds of MBs of data at once will exceed execution limits. Break the work into smaller chunks (e.g., processing 1,000 rows at a time)." That threshold is far above a website's draft.
- "Each individual D1 database is inherently single-threaded, and processes queries one at a time." A publish therefore blocks other writes to the project's database while it runs.

## `batch()` semantics

Source: [D1 Database API, batch](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch) (updated 2026-06-22).

- "Batched statements are SQL transactions. If a statement in the sequence fails, then an error is returned for that specific statement, and it aborts or rolls back the entire sequence."
- Statements run "sequentially, non-concurrently".
- **Not stated:** whether a batch that times out or hits a database reset is rolled back. It follows from "SQL transactions", but a `Network connection lost` error can leave the outcome unknown to the caller. This is why publishing should be idempotent, or able to check whether it already happened.

## Transactions and `exec()`

- **`BEGIN`/`COMMIT` are not supported:**
  - The [import/export guide](https://developers.cloudflare.com/d1/best-practices/import-export-data/) says to remove `BEGIN TRANSACTION` and `COMMIT`, and mentions the error "cannot start a transaction within a transaction".
  - [workerd's SQL regulator](https://github.com/cloudflare/workerd/blob/main/src/workerd/api/sql.c%2B%2B) rejects them with a message pointing to the Durable Object `transaction()` API instead.
- **`exec()`** stops at the first error, and the documentation makes no atomicity claim for it. "Only use this method for maintenance and one-shot tasks."
- **Drizzle:**
  - [`batch()`](https://github.com/drizzle-team/drizzle-orm-docs/blob/main/src/content/docs/sqlite/batch-api.mdx) maps directly to D1's `batch()`.
  - `db.transaction()` issues `begin`/`savepoint` and fails on D1. [drizzle-orm#2463](https://github.com/drizzle-team/drizzle-orm/issues/2463) is still open.
  - No evidence that Drizzle splits large inserts to stay under 100 parameters, so assume it doesn't.
- **Passing arrays:** an array can be passed as one JSON parameter, e.g. `WHERE id IN (SELECT value FROM json_each(?1))` ([querying JSON](https://developers.cloudflare.com/d1/sql-api/query-json/)).

## Read replication

Source: [read replication](https://developers.cloudflare.com/d1/best-practices/read-replication/) (updated 2026-08-10).

Replication only applies through the Sessions API. Replicas receive updates asynchronously. If Camox turns it on, visitors reading through an unconstrained session may still see the previous Live for a moment after a publish. Studio reads should pass a bookmark or use `first-primary`.

## Workers and Workflows limits

Sources: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) (updated 2026-10-12), [Workflows limits](https://developers.cloudflare.com/workflows/reference/limits/) (updated 2026-09-21).

- **CPU per request:** 30 s by default on Paid, configurable up to 5 min. Waiting on D1 doesn't count toward it.
- **Wall-clock time:** unlimited for HTTP requests. `waitUntil()` can keep work running for up to 30 s after the response is sent.
- **Memory:** 128 MB per isolate.
- **Subrequest counts disagree:** the Workers page lists 10,000 subrequests on Paid, while the D1 page lists 1,000 queries per invocation. Not resolved; verify before relying on either.
- **Workflows**, if publishing ever needs to run as resumable steps: up to 5 min of CPU per step, unlimited wall-clock time per step, 1 MiB step results, and up to 25,000 steps.

## Errors worth handling

Source: [Debug D1](https://developers.cloudflare.com/d1/observability/debug-d1/) (updated 2026-08-11), [Retry queries](https://developers.cloudflare.com/d1/best-practices/retry-queries/) (updated 2026-08-10).

- **Worth retrying, when the operation is idempotent:**
  - "Network connection lost."
  - "D1 DB reset because its code was updated."
  - "Internal error in D1 DB storage caused object to be reset."
  - "Cannot resolve D1 DB due to transient issue on remote node."
- **Reduce the work instead:** timeouts on storage operations, the database being overloaded, or the database exceeding its CPU or memory limits. The documented remedy is to split the work.
- D1 retries read-only queries up to twice by itself, but never queries that write.

## SQL features

Source: [SQL statements](https://developers.cloudflare.com/d1/sql-api/sql-statements/) (updated 2026-04-21).

- Supported: SQLite's query engine, plus the JSON and FTS5 extensions.
- `PRAGMA defer_foreign_keys = on` lasts until the end of the current transaction, so inside a batch it can relax the order of inserts during a publish.
- Not documented: the SQLite version, `UPDATE … FROM`, and CTEs inside writes. Test them in `wrangler dev` and against a remote database.

## Not verified

- Whether a batch counts as one query or N toward the per-invocation limit.
- Whether the Paid limit is 1,000 D1 queries or 10,000 subrequests per invocation.
- Exact runtime error messages for a statement that is too long or has too many parameters.
- An explicit statement that a batch is rolled back after a timeout.
- D1's SQLite version and support for `UPDATE … FROM`.
