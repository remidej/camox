import { DEVELOPMENT_DRAFT } from "@camox/api-contract/drafts";
import { object } from "@optique/core/constructs";
import { command, constant, option } from "@optique/core/primitives";

import { getDevelopmentDraft, getProject } from "../lib/api";
import { readAuthTokenForUrl } from "../lib/auth";
import { isNoDevelopmentDraft, printError } from "../lib/output";
import {
  RuntimeDirectoryError,
  RuntimeMalformedError,
  RuntimeNotFoundError,
  loadRuntime,
} from "../lib/runtime";
import { cwdFlag, projectFlag } from "../lib/runtime-options";

export const parser = command(
  "status",
  object({
    command: constant("status" as const),
    cwd: cwdFlag,
    project: projectFlag,
    json: option("--json"),
  }),
);

type Args = { cwd?: string; command: "status"; project?: string; json: boolean };

/**
 * Whether the caller's development draft exists and how many changes it holds, or why that
 * couldn't be told. Status keeps working without the API, so failures are reported, not thrown.
 */
type DevelopmentDraftStatus =
  | { exists: true; changeCount: number }
  | { exists: false; changeCount: 0 }
  | { exists: null; error: string };

async function developmentDraftStatus(params: {
  token: string;
  apiUrl: string;
  /** A Project ID or a Project Slug. */
  project: string;
  disableTelemetry?: boolean;
}): Promise<DevelopmentDraftStatus> {
  try {
    const project = await getProject(params.token, params.project, params.apiUrl);
    const draft = await getDevelopmentDraft({ ...params, projectId: project.id });
    return { exists: true, changeCount: draft.changeCount };
  } catch (err) {
    if (isNoDevelopmentDraft(err)) return { exists: false, changeCount: 0 };
    return { exists: null, error: err instanceof Error ? err.message : String(err) };
  }
}

function describeDraft(draft: DevelopmentDraftStatus | null, authenticationUrl: string): string {
  if (!draft) return `(sign in to see it — run \`camox login\` for ${authenticationUrl})`;
  if (draft.exists === null) return `(couldn't be checked: ${draft.error})`;
  if (!draft.exists) return "no development draft yet — run your site locally once to create it";
  if (draft.changeCount === 0) return "no changes";
  return `${draft.changeCount} change${draft.changeCount === 1 ? "" : "s"} — \`camox publish\` lists them`;
}

export async function handler(args: Args): Promise<never> {
  let runtime;
  try {
    runtime = loadRuntime(args.cwd);
  } catch (err) {
    if (err instanceof RuntimeDirectoryError) {
      printError({ code: "INVALID_CWD", message: err.message });
      process.exit(2);
    }
    if (err instanceof RuntimeNotFoundError || err instanceof RuntimeMalformedError) {
      printError({ code: "RUNTIME_NOT_FOUND", message: err.message });
      process.exit(2);
    }
    throw err;
  }

  const project = args.project?.trim() || process.env.CAMOX_PROJECT?.trim() || runtime.projectId;
  const token = readAuthTokenForUrl(runtime.authenticationUrl, args.cwd);
  const developmentDraft = token
    ? await developmentDraftStatus({
        token: token.token,
        apiUrl: runtime.apiUrl,
        project,
        disableTelemetry: runtime.disableTelemetry,
      })
    : null;
  const status = {
    project,
    // Every command works in the caller's development draft (ADR 0010).
    draft: DEVELOPMENT_DRAFT,
    developmentDraft,
    apiUrl: runtime.apiUrl,
    authenticationUrl: runtime.authenticationUrl,
    authenticated: token !== null,
    user: token ? { name: token.name, email: token.email } : null,
  };

  if (args.json || !process.stdout.isTTY) {
    process.stdout.write(`${JSON.stringify(status, null, process.stdout.isTTY ? 2 : 0)}\n`);
    process.exit(0);
  }

  const lines = [
    `project:     ${status.project}`,
    `draft:       ${describeDraft(developmentDraft, status.authenticationUrl)}`,
    `api:         ${status.apiUrl}`,
    `auth:        ${status.authenticationUrl}`,
    status.user
      ? `signed in:   ${status.user.name} <${status.user.email}>`
      : `signed in:   (no token for ${status.authenticationUrl} — run \`camox login\`)`,
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
  process.exit(0);
}
