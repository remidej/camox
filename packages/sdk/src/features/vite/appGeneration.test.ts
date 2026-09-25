import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { generateAppFile } from "./appGeneration";

void test("generated app discovers and registers collections alongside existing blocks/layouts", (t) => {
  const root = mkdtempSync(join(tmpdir(), "camox-app-generation-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  generateAppFile(root);
  const app = readFileSync(join(root, "src/camox/app.ts"), "utf8");
  assert.match(app, /\.\.\/collections\/\*\.\{ts,tsx\}/);
  assert.match(app, /\.\/collections\/\*\.\{ts,tsx\}/);
  assert.match(app, /mod\.collection/);
  assert.match(app, /createApp\(\{\s*blocks,\s*layouts,\s*collections,/);
  generateAppFile(root);
  assert.equal(readFileSync(join(root, "src/camox/app.ts"), "utf8"), app);
});
