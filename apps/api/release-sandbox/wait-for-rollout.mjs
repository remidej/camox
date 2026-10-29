// Waits until the revision sandbox's latest image has reached all of its instances. Run after
// `deploy:release-sandbox` by the deploy workflow's `refresh-sandbox-install` job, before the
// Upgrades start: a revision sandbox that starts on the image before has the Template's previous
// install, so its first build runs `pnpm install` (Dockerfile). Needs CLOUDFLARE_ACCOUNT_ID and
// CLOUDFLARE_API_TOKEN. When it can't tell, it warns and lets the Upgrades go: they only build
// slower then.

/** The revision sandbox's Containers application: the Worker's name and the class's (wrangler.jsonc). */
const APPLICATION = "camox-release-sandbox-revisionsandbox";
/** Rollouts done with: on every instance, or superseded by a later one. */
const DONE = new Set(["completed", "replaced"]);
const POLL_MS = 10_000;
const TIMEOUT_MS = 10 * 60_000;

const log = (message) => console.info(`[wait-for-rollout] ${message}`);

/** Calls the Cloudflare Containers REST API and unwraps Cloudflare's envelope. */
async function containers(route) {
  const { CLOUDFLARE_ACCOUNT_ID: accountId, CLOUDFLARE_API_TOKEN: token } = process.env;
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/containers${route}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const envelope = await response.json().catch(() => null);
  if (!response.ok || !envelope?.success) {
    throw new Error(`Cloudflare Containers GET ${route} answered ${response.status}`);
  }
  return envelope.result;
}

async function main() {
  if (!process.env.CLOUDFLARE_ACCOUNT_ID || !process.env.CLOUDFLARE_API_TOKEN) {
    throw new Error("CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN aren't set");
  }
  const application = (await containers("/applications")).find(({ name }) => name === APPLICATION);
  if (!application) throw new Error(`there's no Containers application ${APPLICATION}`);
  const startedAt = Date.now();
  for (;;) {
    const [latest] = (await containers(`/applications/${application.id}/rollouts`)).sort(
      (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
    );
    // A deploy that left the image as it was starts no rollout: the last one is then done.
    if (!latest || DONE.has(latest.status)) {
      log(`The image is on every instance (${latest?.status ?? "no rollout"}).`);
      return;
    }
    if (Date.now() - startedAt > TIMEOUT_MS) {
      throw new Error(`its rollout is still ${latest.status} after ${TIMEOUT_MS / 60_000} minutes`);
    }
    const percent = latest.progress?.version_distribution?.target_version_percentage;
    log(`Rollout ${latest.status}${percent === undefined ? "" : `, ${percent}%`}: waiting.`);
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

main().catch((error) => {
  const message = `The Upgrades may start before the revision sandbox's new image: ${error.message}`;
  // Annotated in GitHub Actions, where deploys run.
  console.warn(
    process.env.GITHUB_ACTIONS ? `::warning::${message}` : `[wait-for-rollout] ${message}`,
  );
});
