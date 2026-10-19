import assert from "node:assert/strict";
import { test } from "node:test";

import * as React from "react";

import { HOVER_INTENT_DELAY, PREFETCH_STALE_TIME, createPrefetchCache } from "./linkPrefetch";
import { openPage as openSite } from "./pageNavigation.fixtures";

async function openPage(t: test.TestContext, url: string, studio: boolean) {
  const page = await openSite(t, url, { studio });
  // Events come from the window that shows the page, as the visitor's input does.
  const viewport = page.viewport() as unknown as Window & typeof globalThis;
  const fire = (event: Event, id: string) =>
    React.act(async () => {
      page.element(id).dispatchEvent(event);
    });
  const wait = (ms: number) =>
    React.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, ms));
    });
  return {
    ...page,
    hover: (id: string) => fire(new viewport.MouseEvent("mouseover", { bubbles: true }), id),
    leave: (id: string) =>
      fire(
        new viewport.MouseEvent("mouseout", {
          bubbles: true,
          relatedTarget: viewport.document.body,
        }),
        id,
      ),
    focus: (id: string) => fire(new viewport.FocusEvent("focusin", { bubbles: true }), id),
    touch: (id: string) => fire(new viewport.Event("touchstart", { bubbles: true }), id),
    restOnLink: () => wait(HOVER_INTENT_DELAY * 2),
  };
}

for (const [surface, studio] of [
  ["visitor window", false],
  ["Studio preview", true],
] as const) {
  void test(`resting the pointer on a link loads its page, which following the link then shows (${surface})`, async (t) => {
    const page = await openPage(t, "https://site.test/", studio);

    await page.hover("to-pricing");
    assert.deepEqual(page.dataRequests, [], "not while the pointer only passes over it");
    await page.restOnLink();
    assert.deepEqual(page.dataRequests, ["/pricing"]);

    await page.click("to-pricing");

    assert.equal(page.shownPage(), "/pricing");
    assert.deepEqual(page.dataRequests, ["/pricing"], "the page isn't read twice");
  });

  void test(`passing over a link loads nothing (${surface})`, async (t) => {
    const page = await openPage(t, "https://site.test/", studio);

    await page.hover("to-pricing");
    await page.leave("to-pricing");
    await page.restOnLink();

    assert.deepEqual(page.dataRequests, []);
  });

  void test(`moving within a link keeps it hovered (${surface})`, async (t) => {
    const page = await openPage(t, "https://site.test/", studio);

    await page.hover("to-pricing");
    await page.hover("pricing-label");
    await page.restOnLink();

    assert.deepEqual(page.dataRequests, ["/pricing"]);
  });

  void test(`focusing or touching a link loads its page right away (${surface})`, async (t) => {
    const page = await openPage(t, "https://site.test/", studio);

    await page.focus("to-pricing");
    await page.touch("to-about");

    assert.deepEqual(page.dataRequests, ["/pricing", "/about"]);
  });

  void test(`links to the shown page load nothing (${surface})`, async (t) => {
    const page = await openPage(t, "https://site.test/pricing", studio);

    await page.focus("to-details");
    await page.focus("to-pricing-details");

    assert.deepEqual(page.dataRequests, []);
  });

  void test(`a link loads its page once, however often it's hovered or focused (${surface})`, async (t) => {
    const page = await openPage(t, "https://site.test/", studio);

    await page.focus("to-pricing");
    await page.hover("to-pricing");
    await page.restOnLink();
    await page.focus("to-pricing-details");

    assert.deepEqual(page.dataRequests, ["/pricing"]);
  });

  void test(`a visitor saving data loads nothing ahead (${surface})`, async (t) => {
    const page = await openPage(t, "https://site.test/", studio);
    Object.defineProperty(page.viewport().navigator, "connection", { value: { saveData: true } });

    await page.focus("to-pricing");

    assert.deepEqual(page.dataRequests, []);
  });
}

void test("a page loaded too long ago is read again when its link is followed", () => {
  let now = 0;
  const cache = createPrefetchCache<string>({ now: () => now });
  let loads = 0;
  const load = async () => `load ${++loads}`;

  cache.prefetch("/pricing", load);
  cache.prefetch("/pricing", load);
  assert.equal(loads, 1);

  now += PREFETCH_STALE_TIME;
  assert.equal(cache.take("/pricing"), undefined);

  cache.prefetch("/pricing", load);
  assert.equal(loads, 2);
  assert.ok(cache.take("/pricing"));
  assert.equal(cache.take("/pricing"), undefined, "a load serves one navigation");
});

void test("a failed load is forgotten, so the link tries again", async () => {
  const cache = createPrefetchCache<string>();
  cache.prefetch("/pricing", () => Promise.reject(new Error("offline")));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(cache.take("/pricing"), undefined);
});
