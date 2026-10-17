import assert from "node:assert/strict";
import { test } from "node:test";

import { type BundlerOnLog, withoutExpectedCamoxLogs } from "./bundlerLogs";

type BundlerLog = Parameters<BundlerOnLog>[1];

function passedThrough(log: BundlerLog, onLog?: BundlerOnLog): BundlerLog[] {
  const logged: BundlerLog[] = [];
  withoutExpectedCamoxLogs(onLog)("warn", log, (_level, passed) => {
    if (typeof passed !== "string") logged.push(passed);
  });
  return logged;
}

const useClientDirective: BundlerLog = {
  code: "MODULE_LEVEL_DIRECTIVE",
  message:
    'The semantics of the module level directive "use client" in "node_modules/@tanstack/react-query/build/modern/useQuery.js" may not be preserved when bundling.',
};

const useServerDirective: BundlerLog = {
  code: "MODULE_LEVEL_DIRECTIVE",
  message:
    'The semantics of the module level directive "use server" in "src/actions.ts" may not be preserved when bundling.',
};

const lazyBlockAlsoImportedByLayout: BundlerLog = {
  code: "INEFFECTIVE_DYNAMIC_IMPORT",
  message:
    "src/blocks/footer.tsx is dynamically imported by \0virtual:camox/app but also statically imported by src/layouts/default.tsx, dynamic import will not move module into another chunk.",
};

const layoutBlockAlsoImportedByServerApp: BundlerLog = {
  code: "INEFFECTIVE_DYNAMIC_IMPORT",
  message:
    "src/blocks/hero.tsx is dynamically imported by src/layouts/default.tsx but also statically imported by \0virtual:camox/app, dynamic import will not move module into another chunk.",
};

const appOwnDynamicImport: BundlerLog = {
  code: "INEFFECTIVE_DYNAMIC_IMPORT",
  message:
    "src/lib/chart.ts is dynamically imported by src/blocks/stats.tsx but also statically imported by src/blocks/hero.tsx, dynamic import will not move module into another chunk.",
};

void test("Bundling drops warnings every Camox app produces", () => {
  assert.deepEqual(passedThrough(useClientDirective), []);
  assert.deepEqual(passedThrough(lazyBlockAlsoImportedByLayout), []);
  assert.deepEqual(passedThrough(layoutBlockAlsoImportedByServerApp), []);
});

void test("Bundling keeps warnings about the app's own code", () => {
  assert.deepEqual(passedThrough(useServerDirective), [useServerDirective]);
  assert.deepEqual(passedThrough(appOwnDynamicImport), [appOwnDynamicImport]);
});

void test("Bundling hands the app's own log handler only the warnings it keeps", () => {
  const seenByApp: BundlerLog[] = [];
  const onLog: BundlerOnLog = (_level, log) => {
    seenByApp.push(log);
  };

  passedThrough(useClientDirective, onLog);
  passedThrough(appOwnDynamicImport, onLog);

  assert.deepEqual(seenByApp, [appOwnDynamicImport]);
});
