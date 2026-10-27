import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { ICON_CATALOG_VERSION } from "@camox/api-contract";

import { generateIconTypes } from "./iconGeneration";

void test("type generation uses the pinned catalog and requires prefixed IDs", async () => {
  const root = mkdtempSync(join(tmpdir(), "camox-icons-"));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    // The version the API resolves icons from, so types and rendered icons agree.
    assert.ok(
      (input instanceof Request ? input.url : String(input)).endsWith(
        `/@iconify/json@${ICON_CATALOG_VERSION}/json/generation-test.json`,
      ),
    );
    return Response.json({
      prefix: "generation-test",
      icons: { zap: { body: "<path />" } },
      info: { license: { title: "MIT" } },
    });
  };
  try {
    assert.deepEqual(await generateIconTypes(root, "generation-test"), ["generation-test:zap"]);
    assert.match(
      readFileSync(join(root, "src/camox/icons.gen.d.ts"), "utf8"),
      /ids: "generation-test:zap"/,
    );
    await generateIconTypes(root);
    assert.match(readFileSync(join(root, "src/camox/icons.gen.d.ts"), "utf8"), /ids: never/);
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(root, { recursive: true, force: true });
  }
});
