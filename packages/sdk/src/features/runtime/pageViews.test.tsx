import assert from "node:assert/strict";
import { test } from "node:test";

import { openPage, titleOf } from "./pageNavigation.fixtures";

const GA4 = { ga4: { measurementId: "G-TEST123" } };

/** The page views sent to GA4. */
const pageViews = (calls: unknown[][]) =>
  calls.filter(([command, event]) => command === "event" && event === "page_view");

void test("a visitor's page sends one GA4 page view on first load, with its path and title", async (t) => {
  const page = await openPage(t, "https://site.test/pricing?plan=pro", { analytics: GA4 });
  await page.settle();
  assert.deepEqual(pageViews(page.gtagCalls), [
    [
      "event",
      "page_view",
      {
        page_location: "https://site.test/pricing?plan=pro",
        page_path: "/pricing",
        page_title: titleOf("/pricing"),
      },
    ],
  ]);
});

void test("the studio presentation sends no page view", async (t) => {
  const page = await openPage(t, "https://site.test/pricing", { analytics: GA4, studio: true });
  await page.settle();
  assert.deepEqual(page.gtagCalls, []);
});

void test("a render input without providers sends no page view", async (t) => {
  const page = await openPage(t, "https://site.test/pricing");
  await page.settle();
  assert.deepEqual(page.gtagCalls, []);
});
