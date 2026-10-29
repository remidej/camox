import { z } from "zod";

import type { LintError } from "./result";

// What a lint prints (sandbox.ts): Oxlint's JSON report, after whatever the project's Vite config
// logged as `vp lint` loaded it (the Camox plugin says what it builds), such as:
//
//   4:00:00 AM [vite+] Building Camox app (Live, not released)
//   { "diagnostics": [{"message": "`debugger` statement is not allowed","code": "eslint(no-debugger)",
//     "severity": "warning", …, "help": "Remove the debugger statement","filename": "src/x.ts",
//     "labels": [{"span": {"offset": 33,"length": 9,"line": 2,"column": 3}}]}], "number_of_files": 24, … }

const reportSchema = z.object({
  diagnostics: z.array(
    z.object({
      message: z.string(),
      code: z.string().optional(),
      help: z.string().optional(),
      filename: z.string(),
      labels: z.array(z.object({ span: z.object({ line: z.number() }) })).optional(),
    }),
  ),
});

/** Files the agent may change: `src/`, except the platform's `src/camox/`. */
const isAgents = (file: string) => file.startsWith("src/") && !file.startsWith("src/camox/");

/** Whether lint lints the file `path`: one the agent may change, of JavaScript or TypeScript. */
export const lintable = (path: string) => isAgents(path) && /\.[cm]?[jt]sx?$/.test(path);

/**
 * The findings of a lint in `files`, or nothing when its output has no report, as when the run
 * itself failed. Syntax errors, which name no rule, are left out: the build reports them.
 */
export function lintErrorsOf(output: string, files: string[]): LintError[] | undefined {
  const start = output.search(/^\{/m);
  if (start === -1) return undefined;
  let report: unknown;
  try {
    report = JSON.parse(output.slice(start));
  } catch {
    return undefined;
  }
  const parsed = reportSchema.safeParse(report);
  if (!parsed.success) return undefined;
  const linted = new Set(files);
  return parsed.data.diagnostics.flatMap(({ message, code, help, filename, labels }) =>
    linted.has(filename) && code !== undefined
      ? [
          {
            file: filename,
            line: labels?.[0]?.span.line ?? 0,
            rule: code,
            message: help ? `${message}. ${help}` : message,
          },
        ]
      : [],
  );
}
