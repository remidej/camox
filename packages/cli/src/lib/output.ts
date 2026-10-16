import { NO_DEVELOPMENT_DRAFT_ERROR } from "@camox/api-contract/drafts";

/**
 * Output formatting for tool dispatch commands.
 *
 * The contract (per the agentic-tools plan):
 * - pretty-printed JSON when stdout is a TTY (and `--json` not set)
 * - raw JSON otherwise — coding agents pipe stdout into the next step
 * - errors go to stderr as JSON `{ code, message, details? }` so the
 *   self-correction loop on validation failures has structured data to read
 *
 * "Pretty" deliberately stays JSON: every tool result is structured, so we
 * just indent it and let the terminal handle the rest.
 */

export type OutputMode = "auto" | "json";

export function isJsonMode(mode: OutputMode): boolean {
  if (mode === "json") return true;
  return !process.stdout.isTTY;
}

export function printResult(value: unknown, mode: OutputMode): void {
  const indent = isJsonMode(mode) ? 0 : 2;
  process.stdout.write(`${JSON.stringify(value, null, indent)}\n`);
}

export type CliError = {
  code: string;
  message: string;
  details?: unknown;
};

export function printError(err: CliError): void {
  process.stderr.write(`${JSON.stringify(err)}\n`);
}

/**
 * Parse a JSON flag value, surfacing a structured CLI error if the input
 * isn't valid JSON. Block `content` and `settings` arrive this way.
 */
export function parseJsonFlag(name: string, raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw Object.assign(new Error(`Invalid JSON for ${name}: ${message}`), {
      __cliError: { code: "INVALID_JSON", message: `Invalid JSON for ${name}`, details: message },
    });
  }
}

/**
 * Only the first dev-mode sync after login creates the development draft, so the CLI can't
 * (ADR 0010).
 */
export const NO_DEVELOPMENT_DRAFT_CLI_ERROR: CliError = {
  code: NO_DEVELOPMENT_DRAFT_ERROR,
  message:
    "You have no development draft in this project yet. Run your site locally once (e.g. `pnpm dev`) to create your development draft, then retry.",
};

/** Whether an error, or an error response body, says the caller has no development draft. */
export function isNoDevelopmentDraft(err: unknown): boolean {
  if (!err || typeof err !== "object" || !("code" in err)) return false;
  return err.code === NO_DEVELOPMENT_DRAFT_ERROR;
}

export function asCliError(err: unknown): CliError {
  if (err && typeof err === "object" && "__cliError" in err) {
    return (err as { __cliError: CliError }).__cliError;
  }
  if (isNoDevelopmentDraft(err)) return NO_DEVELOPMENT_DRAFT_CLI_ERROR;
  if (err instanceof Error) {
    return { code: "INTERNAL_ERROR", message: err.message };
  }
  return { code: "INTERNAL_ERROR", message: String(err) };
}
