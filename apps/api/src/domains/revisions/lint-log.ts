import { z } from "zod";

import type { LintError } from "./result";

// What `vp lint --format json` prints: Oxlint's JSON report, after whatever the project's Vite
// config logged as Vite+ loaded it (the Camox plugin says what it builds), such as:
//
//   4:00:00 AM [vite+] Building Camox app (your development draft)
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

/**
 * The findings of a `vp lint --format json` run in files the agent may change, or nothing when
 * its output has no report, as when the run itself failed.
 */
export function lintErrorsOf(output: string): LintError[] | undefined {
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
  return parsed.data.diagnostics
    .filter(({ filename }) => isAgents(filename))
    .map(({ message, code, help, filename, labels }) => ({
      file: filename,
      line: labels?.[0]?.span.line ?? 0,
      rule: code ?? "",
      message: help ? `${message}. ${help}` : message,
    }));
}
