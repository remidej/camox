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
  assert.match(app, /createApp\(\{\s*blocks,\s*layouts,\s*collections\s*\}\)/);
});
