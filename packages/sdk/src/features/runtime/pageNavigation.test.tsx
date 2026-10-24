import assert from "node:assert/strict";
import { test } from "node:test";

import { openPage } from "./pageNavigation.fixtures";

void test("a visitor's window loads the blocks of each page it navigates to", async (t) => {
  const page = await openPage(t, "https://site.test/");

  await page.click("to-pricing");

  assert.equal(page.shownPage(), "/pricing");
  assert.equal(page.blockLoads.length, 1);
});

void test("a member's window navigates without loading any block: only the renderer frame runs the site's code", async (t) => {
  const page = await openPage(t, "https://site.test/", { studio: true });

  await page.click("to-pricing");

  assert.equal(page.shownPage(), "/pricing");
  assert.deepEqual(page.blockLoads, []);
});
