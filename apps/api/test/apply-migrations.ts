import { env } from "cloudflare:workers";

// Mirrors `applyD1Migrations` from `cloudflare:test`. Importing that module from
// a setup file makes workerd exit before the next test file on the same worker
// (@cloudflare/vitest-plugin 1.4 with Vitest 5).
// https://github.com/cloudflare/workers-sdk/issues/16331
for (const migration of env.TEST_MIGRATIONS ?? []) {
  await env.DB.batch(migration.queries.map((query) => env.DB.prepare(query)));
}
