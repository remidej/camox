import { PUBLISHING_DRAFT_VAR } from "@camox/api-contract/drafts";
import { getSandbox } from "@cloudflare/sandbox";

import type { Bindings } from "../../types";

// A publish with code uploads and promotes the project's Worker with wrangler, in a small
// sandbox of its own, one per project, with wrangler in its image (release-sandbox/): it never
// installs or builds anything, and never sees the project's Deploy Token. The Worker it uploads
// is the revision's build, as members previewed it (ADR 0020).

/** The dispatch namespace every project's Worker is deployed to (../releases/README.md). */
const DISPATCH_NAMESPACE = "production";
/** Where the revision's build is unpacked. */
const WORKSPACE = "/workspace/publish";
/** Where the revision's build is written before it's unpacked. */
const ARCHIVE = "/tmp/camox-publish.tar.gz";
/**
 * The server build's Wrangler configuration, which names its client assets: the one directory of
 * `dist/` beside `client/` (apps/dispatch/src/revisions.ts reads the same).
 */
const SERVER_CONFIG = `"$(find dist -mindepth 2 -maxdepth 2 -name wrangler.json ! -path 'dist/client/*' | head -n 1)"`;

/** The ID `wrangler versions upload` prints for the version it uploaded. */
const UPLOADED_VERSION = /Worker Version ID:\s*([0-9a-f-]{36})/i;

/** A sandbox that failed to do its part. Workflows retry the step. */
export class PublishSandboxError extends Error {
  override name = "PublishSandboxError";
}

const sandboxOf = (env: Pick<Bindings, "PUBLISH_SANDBOX">, project: string) =>
  getSandbox(env.PUBLISH_SANDBOX, project);

const tail = (text: string, lines = 20) => text.trimEnd().split("\n").slice(-lines).join("\n");

/** Runs wrangler with Camox's Cloudflare token, which only this sandbox and releases' deploy get. */
async function wrangler(
  env: Pick<Bindings, "PUBLISH_SANDBOX" | "CF_TOKEN" | "CLOUDFLARE_ACCOUNT_ID">,
  project: string,
  args: string,
) {
  const command = `wrangler ${args} --name ${project} --dispatch-namespace ${DISPATCH_NAMESPACE}`;
  const result = await sandboxOf(env, project).exec(command, {
    cwd: WORKSPACE,
    env: { CLOUDFLARE_API_TOKEN: env.CF_TOKEN, CLOUDFLARE_ACCOUNT_ID: env.CLOUDFLARE_ACCOUNT_ID },
  });
  if (!result.success) {
    throw new PublishSandboxError(
      `\`wrangler ${args.split(" ").slice(0, 2).join(" ")}\` exited with ${result.exitCode}: ${tail(`${result.stdout}\n${result.stderr}`)}`,
    );
  }
  return result.stdout;
}

/**
 * Uploads the revision's build as a new version of the project's Worker, without serving it. The
 * version carries the publishing draft's ID, so its public reads see Live overlaid with the draft
 * while the draft publishes (`PUBLISHING_DRAFT_HEADER`). Returns the version's ID.
 */
export async function uploadVersion(
  env: Pick<Bindings, "PUBLISH_SANDBOX" | "REVISION_BUILDS" | "CF_TOKEN" | "CLOUDFLARE_ACCOUNT_ID">,
  { project, draft, archiveKey }: { project: string; draft: string; archiveKey: string },
): Promise<string> {
  const archive = await env.REVISION_BUILDS.get(archiveKey);
  if (!archive) throw new PublishSandboxError(`The revision's build ${archiveKey} isn't stored`);
  const sandbox = sandboxOf(env, project);
  await sandbox.writeFile(ARCHIVE, archive.body);
  const unpacked = await sandbox.exec(
    `rm -rf ${WORKSPACE} && mkdir -p ${WORKSPACE} && tar -xzf ${ARCHIVE} -C ${WORKSPACE}`,
  );
  if (!unpacked.success) {
    throw new PublishSandboxError(`The revision's build didn't unpack: ${tail(unpacked.stderr)}`);
  }
  const output = await wrangler(
    env,
    project,
    `versions upload --config ${SERVER_CONFIG} --message "Publish of draft ${draft}" --var ${PUBLISHING_DRAFT_VAR}:${draft}`,
  );
  const version = UPLOADED_VERSION.exec(output)?.[1];
  if (!version) throw new PublishSandboxError(`No version ID in: ${tail(output)}`);
  return version;
}

/** The version of the project's Worker serving all its traffic, if any does. */
export async function servedVersion(
  env: Pick<Bindings, "PUBLISH_SANDBOX" | "CF_TOKEN" | "CLOUDFLARE_ACCOUNT_ID">,
  project: string,
): Promise<string | null> {
  const output = await wrangler(env, project, "deployments status --json");
  const status = JSON.parse(output) as { versions?: { version_id: string; percentage: number }[] };
  return status.versions?.find(({ percentage }) => percentage === 100)?.version_id ?? null;
}

/** Serves every request to the project's Worker with `version`. */
export async function promoteVersion(
  env: Pick<Bindings, "PUBLISH_SANDBOX" | "CF_TOKEN" | "CLOUDFLARE_ACCOUNT_ID">,
  project: string,
  version: string,
) {
  await wrangler(env, project, `versions deploy ${version}@100% --yes`);
}
