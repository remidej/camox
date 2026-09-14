import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

import { PLATFORM_SCRIPT } from "./platform";

void test("platform selection runs without React, before the first paint", () => {
  for (const [userAgent, expected] of [
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "mac"],
    ["Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)", "mac"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "other"],
    ["Mozilla/5.0 (X11; Linux x86_64)", "other"],
  ]) {
    const dataset: Record<string, string> = {};
    runInNewContext(PLATFORM_SCRIPT, {
      document: { documentElement: { dataset } },
      navigator: { userAgent },
    });
    assert.equal(dataset.camoxPlatform, expected);
  }
});
