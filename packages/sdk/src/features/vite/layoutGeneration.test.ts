import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { format } from "vite-plus/fmt";

import { generateLayoutFiles } from "./layoutGeneration";

const cases = [
  { name: "empty directory", layouts: [] },
  { name: "starter layout", layouts: ["default"] },
  { name: "static routes", layouts: ["about", "blog.post", "contact-us", "日本語", "123"] },
  { name: "dynamic routes", layouts: ["$slug", "blog.$postId", "$category.$post-id"] },
  { name: "long routes", layouts: [`${"long".repeat(30)}.$${"param".repeat(25)}`] },
];

for (const { name, layouts } of cases) {
  void test(`generated layout declarations match starter formatting: ${name}`, async (t) => {
    const root = mkdtempSync(join(tmpdir(), "camox-layout-generation-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    mkdirSync(join(root, "src/layouts"), { recursive: true });
    for (const layout of layouts) {
      writeFileSync(join(root, `src/layouts/${layout}.tsx`), "export {};\n");
    }

    generateLayoutFiles(root);
    const path = join(root, "src/camox/layouts.gen.d.ts");
    const generated = readFileSync(path, "utf8");
    // The starter has no fmt overrides. Use the formatter directly so repository
    // ignore patterns cannot hide regressions in generated declarations.
    const formatted = await format(path, generated);
    assert.deepEqual(formatted.errors, []);
    assert.equal(generated, formatted.code);

    generateLayoutFiles(root);
    assert.equal(readFileSync(path, "utf8"), generated);
  });
}
