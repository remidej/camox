// Fetches the files of `template-default` (packages/cli/scripts/README.md) that installing it
// reads into template/, from which the release sandbox's image bakes the Template's install for
// revision builds (Dockerfile). Run before the image builds, by `deploy:release-sandbox`, with
// CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN, whose token has Account › Artifacts. Without
// them, or when it fails, it leaves template/ empty and warns: the image then holds no install,
// and each new revision sandbox installs from the network, as before.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const NAMESPACE = "projects";
const REPO = "template-default";
/** What `pnpm install --frozen-lockfile` reads besides the lockfile: its settings too. */
const FILES = ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"];
const target = path.join(import.meta.dirname, "template");

const log = (message) => console.info(`[fetch-template] ${message}`);

/** Empties template/, keeping its .gitignore. */
function emptyTarget() {
  for (const name of readdirSync(target)) {
    if (name !== ".gitignore") rmSync(path.join(target, name), { recursive: true, force: true });
  }
}

/** Calls the Cloudflare Artifacts REST API and unwraps Cloudflare's envelope. */
async function artifacts(method, route, body) {
  const { CLOUDFLARE_ACCOUNT_ID: accountId, CLOUDFLARE_API_TOKEN: token } = process.env;
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/artifacts/namespaces/${NAMESPACE}${route}`,
    {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(body && { body: JSON.stringify(body) }),
    },
  );
  const envelope = await response.json().catch(() => null);
  if (!response.ok || !envelope?.success) {
    throw new Error(`Cloudflare Artifacts ${method} ${route} answered ${response.status}`);
  }
  return envelope.result;
}

async function main() {
  emptyTarget();
  if (!process.env.CLOUDFLARE_ACCOUNT_ID || !process.env.CLOUDFLARE_API_TOKEN) {
    throw new Error("CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN aren't set");
  }
  const repo = await artifacts("GET", `/repos/${REPO}`);
  const { plaintext } = await artifacts("POST", "/tokens", { repo: REPO, scope: "read", ttl: 600 });
  const workDir = mkdtempSync(path.join(tmpdir(), "camox-sandbox-template-"));
  try {
    execFileSync("git", ["clone", "--quiet", "--depth", "1", repo.remote, workDir], {
      stdio: ["ignore", "inherit", "inherit"],
      // Through the environment, so the token stays out of process lists.
      env: {
        ...process.env,
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: "http.extraHeader",
        GIT_CONFIG_VALUE_0: `Authorization: Bearer ${plaintext}`,
      },
    });
    for (const file of FILES) copyFileSync(path.join(workDir, file), path.join(target, file));
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
  log(`Fetched ${FILES.join(", ")} from ${REPO}.`);
}

main().catch((error) => {
  emptyTarget();
  const message = `The sandbox image won't hold the Template's install: ${error.message}`;
  // Annotated in GitHub Actions, where deploys run.
  console.warn(
    process.env.GITHUB_ACTIONS ? `::warning::${message}` : `[fetch-template] ${message}`,
  );
});
