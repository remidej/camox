// Read-only preflight using the same credentials as deployment, without Wrangler.
const expectedAccountId = "22c0a64149eec1bfb1c98056d81fb4bc";
const databaseId = "acd1b39f-b4fb-45b9-b66d-b8f8f1d8b4dd";
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;

if (accountId !== expectedAccountId) {
  console.error("::error::CLOUDFLARE_ACCOUNT_ID does not match the production database's account.");
  process.exit(1);
}

if (!token || token !== token.trim()) {
  console.error("::error::CLOUDFLARE_API_TOKEN is empty or has surrounding whitespace.");
  process.exit(1);
}

console.log("Production account ID matches.");
const baseUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}`;

async function probe(label, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json();
  if (response.ok && body.success) {
    console.log(`${label}: OK`);
    return true;
  }

  // Only print status/error codes, never headers, credentials, or query results.
  const codes = (body.errors ?? []).map((error) => error.code).join(", ");
  console.error(`::error::${label}: HTTP ${response.status}; Cloudflare error codes: ${codes}`);
  return false;
}

const metadataOk = await probe("D1 database metadata", "");
const queryOk = await probe("D1 read-only query", "/query", {
  method: "POST",
  body: JSON.stringify({ sql: "SELECT 1 AS ok" }),
});

if (!metadataOk || !queryOk) {
  console.error(
    "::error::Direct Cloudflare access failed before invoking Wrangler. Check the token's D1 permissions and account scope; no migrations or deployments were attempted.",
  );
  process.exit(1);
}
