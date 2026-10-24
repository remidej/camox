import { env } from "cloudflare:workers";

import { pushToMain } from "./pushes";
import { websiteFixture } from "./threads";

// What tests of revision builds share: a website with code on `main`, the fake revision
// sandbox's controls, and build logs as Vite prints them.

/** A build the fake revision sandbox ran: the tree it was given, and the archive it made. */
export type RevisionBuild = {
  sandbox: string;
  files: Record<string, string>;
  archive: number[] | null;
};

export type RevisionFakes = {
  readFile(repo: string, ref: string, path: string): Promise<string | null>;
  revisionBuilds(sandbox: string): Promise<RevisionBuild[]>;
  failBuildsOf(marker: string, log: string): Promise<void>;
  lintFindingsOf(marker: string, diagnostics: LintDiagnostic[]): Promise<void>;
  revisionCommands(sandbox: string): Promise<{ command: string }[]>;
  /** Holds the next revision build until `releaseBuilds()`. */
  holdBuilds(): Promise<void>;
  releaseBuilds(): Promise<void>;
  /** Makes every type check of a tree holding `marker` report those of `errors` in what it checks. */
  failTypeChecksOf(marker: string, errors: FakeTypeError[]): Promise<void>;
  /** Holds every type check until `releaseTypeChecks()`. */
  holdTypeChecks(): Promise<void>;
  releaseTypeChecks(): Promise<void>;
};

/** A type error the fake sandbox's type check prints, as tsrs does. */
export type FakeTypeError = {
  file: string;
  line: number;
  column: number;
  code: string;
  message: string;
};

export const revisionFakes = (env as unknown as { RELEASE_FAKES: RevisionFakes }).RELEASE_FAKES;

export const HERO = `export const hero = "Welcome to Acme";\n`;
export const PRICING = `export const pricing = "Plans start at $9";\n`;
export const LOCKFILE = `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      camox:
        specifier: 1.0.0
        version: 1.0.0(react@19.3.1)
`;

/** A website whose `main` holds a block, the platform's `package.json` and its lockfile. */
export async function websiteWithCode() {
  const website = await websiteFixture({ home: "Hello" });
  await pushToMain(website.project.uuid, {
    "package.json": `{ "name": "acme", "dependencies": { "camox": "1.0.0" } }\n`,
    "pnpm-lock.yaml": LOCKFILE,
    "src/blocks/hero.tsx": HERO,
  });
  return website;
}

/** A file that doesn't build, marked so the fake sandbox fails the build of any tree holding it. */
export const broken = (marker: string) => `import { pricing } from "./missing"; // ${marker}\n`;

/** The log of a build failing as Vite's does, from the sandbox's workspace. */
export const failedBuild = (
  errors: string[],
) => `vite v8.0.0 building client environment for production...
transforming...
✗ Build failed in 1.20s
error during build:
Build failed with ${errors.length} error${errors.length === 1 ? "" : "s"}:

${errors.join("\n")}
    at aggregateBindingErrorsIntoJsError (file:///workspace/website/node_modules/rolldown/dist/error.mjs:49:18)
`;

/** An unresolved import, as Rolldown reports it, without colors. */
export const unresolved = (
  file: string,
  line: number,
) => `[UNRESOLVED_IMPORT] Could not resolve './missing' in ${file}
   ╭─[ ${file}:${line}:26 ]
   │
 ${line} │ import { pricing } from "./missing";
───╯
`;

/** Makes every build of a tree holding a file marked as `broken` fail, returning the marker. */
export async function failingMarker(file = "src/blocks/pricing.tsx") {
  const marker = crypto.randomUUID();
  await revisionFakes.failBuildsOf(marker, failedBuild([unresolved(file, 1)]));
  return marker;
}

/** Makes every type check of a tree holding the returned marker report `errors`. */
export async function typeErrorsMarker(errors: FakeTypeError[]) {
  const marker = crypto.randomUUID();
  await revisionFakes.failTypeChecksOf(marker, errors);
  return marker;
}

/** A finding as `vp lint --format json` prints it. */
export type LintDiagnostic = {
  message: string;
  code: string;
  severity: "warning" | "error";
  url: string;
  help: string;
  filename: string;
  labels: { span: { offset: number; length: number; line: number; column: number } }[];
};

/** A `debugger` statement's finding, as `vp lint --format json` printed it for the Template. */
export const debuggerStatement = (file: string, line: number): LintDiagnostic => ({
  message: "`debugger` statement is not allowed",
  code: "eslint(no-debugger)",
  severity: "warning",
  url: "https://oxc.rs/docs/guide/usage/linter/rules/eslint/no-debugger.html",
  help: "Remove the debugger statement",
  filename: file,
  labels: [{ span: { offset: 33, length: 9, line, column: 3 } }],
});

/** Makes every lint of a tree holding the marker find `diagnostics`, returning the marker. */
export async function lintedMarker(diagnostics: LintDiagnostic[]) {
  const marker = crypto.randomUUID();
  await revisionFakes.lintFindingsOf(marker, diagnostics);
  return marker;
}

/** How many times the draft's sandbox ran `vp lint`. */
export const lintRuns = async (draftId: string) =>
  (await revisionFakes.revisionCommands(draftId)).filter(({ command }) =>
    command.includes("vp lint"),
  ).length;
