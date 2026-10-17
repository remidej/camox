import assert from "node:assert/strict";
import { test } from "node:test";

import { loadRuntimeDevModule, resolveRuntimeDevId } from "./runtimeDev";

void test("the dev runtime app registers collections alongside blocks and layouts", () => {
  const id = resolveRuntimeDevId("virtual:camox/app");
  assert.ok(id);
  const app = loadRuntimeDevModule(id);
  assert.ok(app);
  assert.match(app, /"\/src\/collections\/\*\.\{ts,tsx\}"/);
  assert.match(app, /"\/src\/camox\/collections\/\*\.\{ts,tsx\}"/);
  assert.match(app, /mod\.collection/);
  assert.match(
    app,
    /createApp\(\{\s*blocks,\s*lazyBlocks,\s*layouts,\s*collections,\s*document: camoxDocument,\s*\}\)/,
  );
});

void test("the browser's app loads blocks on demand, keyed by file name", () => {
  const app = loadRuntimeDevModule("\0virtual:camox/app", { ssr: false });
  assert.ok(app);
  assert.doesNotMatch(app, /"\/src\/blocks\/\*\.\{ts,tsx\}", \{ eager: true \}/);
  assert.match(app, /"\/src\/blocks\/\*\.\{ts,tsx\}", \{ import: "block" \}/);
  assert.doesNotMatch(app, /blockModulePaths/);
});

void test("the server's app loads every block and names their modules for preloading", () => {
  const app = loadRuntimeDevModule("\0virtual:camox/app", { ssr: true });
  assert.ok(app);
  assert.match(app, /"\/src\/blocks\/\*\.\{ts,tsx\}", \{ eager: true \}/);
  assert.match(app, /export const blockModulePaths/);
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
