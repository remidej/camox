import { type CallToolParams, type CallToolResponse, callTool, getProjectBySlug } from "./api";
import { readAuthTokenForUrl } from "./auth";
import { type CliError, type OutputMode, asCliError, printError, printResult } from "./output";
import {
  RuntimeDirectoryError,
  RuntimeMalformedError,
  RuntimeNotFoundError,
  loadRuntime,
} from "./runtime";

/**
 * Strip undefined fields. Optique returns `undefined` for absent optional
 * flags, but the tool's Zod input often distinguishes `key: undefined` from
 * the key being absent. Send only the keys the user actually passed.
 */
function compact<T extends Record<string, unknown>>(input: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

export type DispatchOptions = {
  toolName: string;
  args: Record<string, unknown>;
  /** Slug from `--project` flag if user passed one. Overrides the sidecar. */
  projectFlag?: string;
  /** Starting directory for runtime lookup only; does not change process.cwd(). */
  cwd?: string;
  /**
   * When `true` (from `--production`), target the `production` environment.
   * Default is `dev:<email>` derived from the local auth token — the same
   * environment the vite dev server uses. `--production` is the only way to
   * route writes to prod, so a prior `vite build` can't make the next CLI
   * invocation silently edit production content.
   */
  production?: boolean;
  outputMode: OutputMode;
};

function fail(err: CliError, code: number): never {
  printError(err);
  process.exit(code);
}

async function resolveProjectId(token: string, slug: string, apiUrl: string): Promise<number> {
  try {
    const project = await getProjectBySlug(token, slug, apiUrl);
    return project.id;
  } catch (err) {
    return fail(
      {
        code: "PROJECT_LOOKUP_FAILED",
        message: `Could not load project "${slug}".`,
        details: err instanceof Error ? err.message : String(err),
      },
      2,
    );
  }
}

async function callRemote(params: CallToolParams): Promise<CallToolResponse> {
  try {
    return await callTool(params);
  } catch (err) {
    return fail(asCliError(err), 1);
  }
}

/**
 * Resolve auth + project, call the registered tool via `agent.callTool`,
 * and render the result. Exit codes: 0 on success, 1 on tool error, 2 on
 * auth/project resolution failure.
 *
 * Project, apiUrl, and authenticationUrl come from the vite plugin's
 * `node_modules/.camox/runtime.json` sidecar. `--project <slug>` and
 * `CAMOX_PROJECT` may override the slug. The environment is *not* read
 * from the sidecar — it's derived from auth (`dev:<email>`) by default,
 * with `--production` as the only opt-in for prod.
 */
export async function resolveCommandContext(
  opts: Pick<DispatchOptions, "projectFlag" | "production" | "cwd">,
) {
  let runtime;
  try {
    runtime = loadRuntime(opts.cwd);
  } catch (err) {
    if (err instanceof RuntimeDirectoryError) {
      return fail({ code: "INVALID_CWD", message: err.message }, 2);
    }
    if (err instanceof RuntimeNotFoundError || err instanceof RuntimeMalformedError) {
      return fail({ code: "RUNTIME_NOT_FOUND", message: err.message }, 2);
    }
    throw err;
  }

  const slug = opts.projectFlag?.trim() || process.env.CAMOX_PROJECT?.trim() || runtime.projectSlug;

  const token = readAuthTokenForUrl(runtime.authenticationUrl, opts.cwd);
  if (!token) {
    return fail(
      {
        code: "NOT_AUTHENTICATED",
        message: `No stored credentials for ${runtime.authenticationUrl}. Run \`camox login\` against this backend first.`,
      },
      2,
    );
  }

  if (!opts.production && !token.email) {
    return fail(
      {
        code: "AUTH_INCOMPLETE",
        message: "Auth token is missing an email. Run `camox login` to refresh credentials.",
      },
      2,
    );
  }
  const environmentName = opts.production ? "production" : `dev:${token.email}`;

  const projectId = await resolveProjectId(token.token, slug, runtime.apiUrl);
  return {
    token: token.token,
    apiUrl: runtime.apiUrl,
    environmentName,
    projectId,
    disableTelemetry: runtime.disableTelemetry,
  };
}

export async function dispatch(opts: DispatchOptions): Promise<never> {
  const context = await resolveCommandContext(opts);
  const response = await callRemote({
    ...context,
    name: opts.toolName,
    args: compact(opts.args),
  });

  if (!response.ok) {
    printError(response.error);
    process.exit(1);
  }

  printResult(response.result, opts.outputMode);
  process.exit(0);
}
