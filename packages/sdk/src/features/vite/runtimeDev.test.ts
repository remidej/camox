import assert from "node:assert/strict";
import { test } from "node:test";

import { loadRuntimeDevModule } from "./runtimeDev";

void test("the browser's app loads blocks on demand, keyed by file name", () => {
  const app = loadRuntimeDevModule("\0virtual:camox/app", { ssr: false });
  assert.ok(app);
  assert.doesNotMatch(app, /"\/src\/blocks\/\*\.\{ts,tsx\}", \{ eager: true \}/);
  assert.match(app, /"\/src\/blocks\/\*\.\{ts,tsx\}", \{ import: "block" \}/);
  assert.doesNotMatch(app, /blockModulePaths/);
});

void test("the server module tells the Worker where the runtime is mounted", () => {
  for (const [option, basePath] of [
    [undefined, ""],
    ["/", ""],
    ["site/", "/site"],
  ] as const) {
    const server = loadRuntimeDevModule("\0virtual:camox/server", { runtimeBasePath: option });
    assert.ok(server);
    assert.match(
      server,
      new RegExp(`export const runtimeBasePath = "${basePath.replace("/", "\\/")}";`),
    );
  }
});
