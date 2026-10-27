// One-off migration (#640): stores every artifact source the API's content holds, in Live and in
// every draft, in the artifact source store (src/domains/artifact-sources/backfill.ts). The API's
// deploy runs it once the new API is live and before the landing site deploys, so no public page
// points at a source the store lacks. It reaches the remote `camox` database through Cloudflare's
// D1 HTTP API with CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN (D1 edit), which the deploy job
// already sets. Storing a source again does nothing, so it's safe to run again. Delete this script
// and its deploy step once a release has run it.
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
