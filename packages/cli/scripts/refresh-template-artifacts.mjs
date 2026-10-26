// Refreshes the read-only `template-default` repo on Cloudflare Artifacts, which new projects
// fork, so that it holds the Template at the published SDK. It copies apps/template-default the
// way the CLI does, commits it with a lockfile, checks that a fresh clone installs from that
// frozen lockfile, then pushes to `main`. Re-running it with nothing to change pushes nothing.
//
//   node packages/cli/scripts/refresh-template-artifacts.mjs [--camox-version X.Y.Z] [--remote URL]
//
// Without `--remote`, it pushes to Cloudflare Artifacts, with CLOUDFLARE_ACCOUNT_ID and a
// CLOUDFLARE_API_TOKEN allowed to edit Cloudflare Artifacts (see README.md). `--remote` pushes to
// any Git remote instead, such as a local bare repo, authenticated by the repo token in
// ARTIFACTS_GIT_TOKEN if it's set. `--camox-version` defaults to packages/sdk's version, which is
// the published one once the `publish` job of .github/workflows/deploy.yml has published it.
import { cpSync, existsSync, mkdtempSync, readFileSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { copyTemplateSource, makeStandalone, readWorkspaceCatalog } from "../src/lib/template.ts";
import { installLockfile, run, waitForCamox } from "./install-lockfile.mjs";

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const NAMESPACE = "projects";
const REPO = "template-default";
const BRANCH = "main";

const { values: args } = parseArgs({
  options: { remote: { type: "string" }, "camox-version": { type: "string" } },
});
const camoxVersion =
  args["camox-version"] ??
  JSON.parse(readFileSync(path.join(REPO_ROOT, "packages/sdk/package.json"), "utf-8")).version;

const log = (message) => console.info(`[refresh-template] ${message}`);

/** Calls the Cloudflare Artifacts REST API and unwraps Cloudflare's envelope. */
async function artifacts(method, route, body) {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !token) {
    throw new Error("Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN, or pass --remote.");
  }
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
    const errors = envelope?.errors?.map((e) => `${e.code} ${e.message}`).join(", ");
    throw new Error(
      `Cloudflare Artifacts ${method} ${route} failed (${response.status}): ${errors ?? ""}`,
    );
  }
  return envelope.result;
}

/** Authenticates Git with a repo token, through the environment so it stays out of process lists. */
function gitTokenEnv(token) {
  if (!token) return {};
  return {
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.extraHeader",
    GIT_CONFIG_VALUE_0: `Authorization: Bearer ${token}`,
  };
}

/** The remote to push to, and the environment that authenticates Git against it. */
async function resolveRemote() {
  if (args.remote) return { url: args.remote, env: gitTokenEnv(process.env.ARTIFACTS_GIT_TOKEN) };
  const repo = await artifacts("GET", `/repos/${REPO}`);
  const { plaintext } = await artifacts("POST", "/tokens", {
    repo: REPO,
    scope: "write",
    ttl: 3600,
  });
  return { url: repo.remote, env: gitTokenEnv(plaintext) };
}

async function main() {
  const remote = await resolveRemote();
  const git = (cwd, argv) =>
    run("git", ["-c", "user.name=Camox", "-c", "user.email=noreply@camox.ai", ...argv], {
      cwd,
      env: { ...process.env, ...remote.env },
    });

  // Outside the monorepo, so pnpm doesn't treat the copy as one of its packages.
  const workDir = mkdtempSync(path.join(tmpdir(), "camox-template-artifacts-"));
  try {
    const clone = path.join(workDir, "clone");
    const copy = path.join(workDir, "copy");
    await git(workDir, ["clone", "--quiet", remote.url, clone]);

    copyTemplateSource(
      path.join(REPO_ROOT, "apps/template-default"),
      copy,
      readWorkspaceCatalog(REPO_ROOT),
    );
    makeStandalone(copy, { camoxVersion, packageManager: "pnpm" });
    renameSync(path.join(clone, ".git"), path.join(copy, ".git"));
    // Starting from the previous lockfile keeps every dependency that didn't change where it was.
    const previousLockfile = path.join(clone, "pnpm-lock.yaml");
    if (existsSync(previousLockfile)) cpSync(previousLockfile, path.join(copy, "pnpm-lock.yaml"));

    log(`Waiting for npm to serve camox@${camoxVersion}...`);
    await waitForCamox(camoxVersion, {
      onRetry: (attempt, attempts) =>
        attempt % 6 === 0 && log(`Still waiting for npm (${attempt}/${attempts})...`),
    });

    log(`Resolving the Template's dependencies at camox@${camoxVersion}...`);
    await installLockfile(copy, {
      onRetry: (attempt, attempts) =>
        log(`npm doesn't serve camox@${camoxVersion} yet, retrying (${attempt}/${attempts})...`),
    });

    await git(copy, ["checkout", "--quiet", "-B", BRANCH]);
    await git(copy, ["add", "--all"]);
    const { stdout: changes } = await git(copy, ["status", "--porcelain"]);
    if (!changes.trim()) {
      log("template-default already holds this Template. Nothing to push.");
      return;
    }
    await git(copy, ["commit", "--quiet", "-m", `Update the Template to camox ${camoxVersion}`]);

    log("Checking that a fresh clone installs from the frozen lockfile...");
    const check = path.join(workDir, "check");
    await git(workDir, ["clone", "--quiet", copy, check]);
    await run("pnpm", ["install", "--frozen-lockfile"], { cwd: check });

    await git(copy, ["push", "--quiet", "origin", `HEAD:${BRANCH}`]);
    const { stdout: sha } = await git(copy, ["rev-parse", "HEAD"]);
    log(`Pushed ${sha.trim()} to template-default.`);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

await main();
