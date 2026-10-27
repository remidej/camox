// One-off migration (#640): stores every artifact source the API's content holds, in Live and in
// every draft, in the artifact source store (src/domains/artifact-sources/backfill.ts). Run it
// once the `artifact_sources` table exists, after the API that stores sources on write deployed:
//
//   CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... pnpm exec tsx scripts/backfill-artifact-sources.ts
//
// from apps/api, with a token allowed to edit D1. It reaches the remote `camox` database through
// Cloudflare's D1 HTTP API. Storing a source again does nothing, so it's safe to run again.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/sqlite-proxy";

import { backfillArtifactSources } from "../src/domains/artifact-sources/backfill";

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const apiToken = process.env.CLOUDFLARE_API_TOKEN;
if (!accountId || !apiToken) {
  console.error("Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN (D1 edit).");
  process.exit(1);
}

// The `DB` binding's database, as wrangler.jsonc names it.
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const wranglerConfig = readFileSync(path.join(scriptDir, "../wrangler.jsonc"), "utf8");
const databaseId = /"database_id":\s*"([^"]+)"/.exec(wranglerConfig)?.[1];
if (!databaseId) throw new Error("No database_id in wrangler.jsonc");

type RawResponse = {
  success: boolean;
  errors: { message: string }[];
  result: { results: { columns: string[]; rows: unknown[][] } }[];
};

const db = drizzle(async (sql, params, method) => {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/raw`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ sql, params }),
    },
  );
  const body = (await response.json()) as RawResponse;
  if (!body.success) {
    throw new Error(`D1 query failed: ${body.errors.map((error) => error.message).join("; ")}`);
  }
  const rows = body.result[0]?.results.rows ?? [];
  return { rows: method === "get" ? (rows[0] ?? []) : rows };
});

const count = await backfillArtifactSources(db);
console.log(`Stored ${count} artifact sources (those stored already were left as they were).`);
