import assert from "node:assert/strict";
import { test } from "node:test";

import { openPage } from "./pageNavigation.fixtures";

for (const [surface, studio] of [
  ["visitor window", false],
  ["Studio preview", true],
] as const) {
  void test(`a new page opens at its top, once it shows (${surface})`, async (t) => {
    const page = await openPage(t, "https://site.test/", { studio });
    page.scrollBy(400);

    await page.click("to-about");

    assert.equal(page.shownPage(), "/about");
    assert.deepEqual(page.scrolls.at(-1), { page: "/about", top: 0, behavior: "instant" });
    assert.equal(page.viewport().scrollY, 0);
  });

  void test(`Back and Forward return to where each entry was left (${surface})`, async (t) => {
    const page = await openPage(t, "https://site.test/", { studio });
    const home = page.window.history.state;
    page.scrollBy(400);
    await page.click("to-about");
    const about = page.window.history.state;
    page.scrollBy(250);

    await page.traverse("/", home);

    assert.equal(page.shownPage(), "/");
    assert.equal(page.viewport().scrollY, 400);
    assert.equal(page.scrolls.at(-1)!.page, "/", "restored once the page shows, not before");

    await page.traverse("/about", about);

    assert.equal(page.shownPage(), "/about");
    assert.equal(page.viewport().scrollY, 250);
  });

  void test(`two entries of the same page keep their own positions (${surface})`, async (t) => {
    const page = await openPage(t, "https://site.test/", { studio });
    await page.click("to-about");
    const first = page.window.history.state;
    page.scrollBy(100);
    await page.click("to-pricing");
    await page.click("to-about");
    const second = page.window.history.state;
    page.scrollBy(700);

    await page.traverse("/about", first);
    assert.equal(page.viewport().scrollY, 100);

    await page.traverse("/about", second);
    assert.equal(page.viewport().scrollY, 700);
  });

  void test(`an entry without a saved position opens at its top (${surface})`, async (t) => {
    const page = await openPage(t, "https://site.test/", { studio });
    page.scrollBy(400);

    // An entry made outside the runtime, like a native fragment navigation, has no position.
    await page.traverse("/about", null);

    assert.equal(page.shownPage(), "/about");
    assert.equal(page.viewport().scrollY, 0);
  });

  void test(`a link to a fragment of another page scrolls to it once it shows (${surface})`, async (t) => {
    const page = await openPage(t, "https://site.test/", { studio });
    page.scrollBy(400);
    const scrolls = page.scrolls.length;

    await page.click("to-pricing-details");

    assert.equal(page.window.location.hash, "#details");
    assert.deepEqual(page.fragmentScrolls, [{ id: "details", behavior: "instant" }]);
    assert.equal(page.scrolls.length, scrolls, "no jump to the top first");
  });

  void test(`a link to a fragment of the shown page scrolls to it without reading the page (${surface})`, async (t) => {
    const page = await openPage(t, "https://site.test/pricing", { studio });
    const top = page.window.history.state;
    const entries = page.window.history.length;
    page.scrollBy(150);

    await page.click("to-details");

    assert.equal(page.window.location.hash, "#details");
    assert.equal(page.window.history.length, entries + 1);
    assert.deepEqual(page.dataRequests, []);
    // Like the browser's own fragment navigation, it follows the site's scroll-behavior.
    assert.deepEqual(page.fragmentScrolls, [{ id: "details", behavior: "auto" }]);

    page.scrollBy(300);
    await page.click("to-details");

    assert.equal(page.fragmentScrolls.length, 2, "following it again scrolls to it again");
    assert.equal(page.window.history.length, entries + 1, "without another entry");

    page.scrollBy(900);
    await page.traverse("/pricing", top);

    assert.deepEqual(page.dataRequests, [], "Back within the page doesn't read it again");
    assert.equal(page.viewport().scrollY, 150);
  });

  void test(`positions outlast the document: reloaded, the page returns to where it was (${surface})`, async (t) => {
    const page = await openPage(t, "https://site.test/", { studio });
    const home = page.window.history.state;
    page.scrollBy(400);
    await page.click("to-about");
    page.scrollBy(250);

    await page.reload();

    assert.equal(page.viewport().scrollY, 250);
    assert.equal(page.window.history.scrollRestoration, "manual");

    await page.traverse("/", home);

    assert.equal(page.viewport().scrollY, 400, "and so do the entries before it");
  });
}

void test("leaving the document hands its entry back to the browser", async (t) => {
  const page = await openPage(t, "https://site.test/");
  assert.equal(page.window.history.scrollRestoration, "manual");

  page.window.dispatchEvent(new page.window.Event("pagehide"));
  assert.equal(page.window.history.scrollRestoration, "auto");

  // Shown again from the back/forward cache.
  page.window.dispatchEvent(new page.window.Event("pageshow"));
  assert.equal(page.window.history.scrollRestoration, "manual");
});

void test("in Studio, only the preview scrolls, never the window around it", async (t) => {
  const page = await openPage(t, "https://site.test/", { studio: true });
  const home = page.window.history.state;
  page.scrollBy(400);
  await page.click("to-pricing-details");

  await page.traverse("/", home);

  assert.equal(page.viewport().scrollY, 400);
  assert.deepEqual(page.studioScrolls, []);
});
