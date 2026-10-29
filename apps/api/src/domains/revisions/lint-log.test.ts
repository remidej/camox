import { describe, expect, it } from "vite-plus/test";

import { lintErrorsOf } from "./lint-log";

/** A report as Oxlint prints it with `--format json`: a syntax error names no rule. */
const report = `{ "diagnostics": [{"message": "Unexpected token","severity": "error","filename": "src/broken.ts","labels": [{"span": {"offset": 18,"length": 1,"line": 1,"column": 19}}]},
{"message": "\`debugger\` statement is not allowed","code": "eslint(no-debugger)","severity": "warning","help": "Remove the debugger statement","filename": "src/lintme.ts","labels": [{"span": {"offset": 0,"length": 9,"line": 3,"column": 1}}]},
{"message": "\`debugger\` statement is not allowed","code": "eslint(no-debugger)","severity": "warning","help": "Remove the debugger statement","filename": "src/other.ts","labels": [{"span": {"offset": 0,"length": 9,"line": 1,"column": 1}}]}],
  "number_of_files": 3, "number_of_rules": 127, "threads_count": 8, "start_time": 0.02 }
`;

describe("lintErrorsOf", () => {
  it("reads the findings in the files linted, without syntax errors", () => {
    expect(lintErrorsOf(report, ["src/broken.ts", "src/lintme.ts"])).toEqual([
      {
        file: "src/lintme.ts",
        line: 3,
        rule: "eslint(no-debugger)",
        message: "`debugger` statement is not allowed. Remove the debugger statement",
      },
    ]);
  });

  it("reads nothing from output without a report", () => {
    expect(
      lintErrorsOf("Usage: revision-builder.mjs serve|build|lint <list>\n", []),
    ).toBeUndefined();
  });
});
