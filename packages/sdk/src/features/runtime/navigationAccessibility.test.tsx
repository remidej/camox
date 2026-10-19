import assert from "node:assert/strict";
import { test } from "node:test";

import * as React from "react";

import { openPage } from "./pageNavigation.fixtures";

for (const [surface, studio] of [
  ["visitor window", false],
  ["Studio preview", true],
] as const) {
  void test(`a new page reads out its title, and Tab starts over from its top (${surface})`, async (t) => {
    const page = await openPage(t, "https://site.test/", { studio });
    assert.equal(page.announced(), "", "the page the document opened with is not read out");
    page.element("to-about").focus();

    await page.click("to-about");

    assert.equal(page.announced(), "Title of /about");
    assert.equal(page.focused(), page.viewport().document.body);
  });

  void test(`Back reads out the page and starts focus over too (${surface})`, async (t) => {
    const page = await openPage(t, "https://site.test/", { studio });
    const home = page.window.history.state;
    await page.click("to-about");
    page.element("to-pricing").focus();

    await page.traverse("/", home);

    assert.equal(page.announced(), "Title of /");
    assert.equal(page.focused(), page.viewport().document.body);
  });

  void test(`a fragment takes focus, so Tab continues from it (${surface})`, async (t) => {
    const page = await openPage(t, "https://site.test/", { studio });

    await page.click("to-pricing-details");

    const details = page.element("details");
    assert.equal(page.focused(), details);
    assert.equal(details.getAttribute("tabindex"), "-1");

    await React.act(async () => page.element("to-about").focus());
    assert.equal(details.hasAttribute("tabindex"), false, "once left, it's plain again");
  });

  void test(`within the page, a fragment takes focus without reading anything out (${surface})`, async (t) => {
    const page = await openPage(t, "https://site.test/pricing", { studio });
    const link = page.element("to-missing");
    link.focus();

    await page.click("to-missing");
    assert.equal(page.focused(), link, "a fragment the page lacks leaves focus alone");

    await page.click("to-details");
    assert.equal(page.focused(), page.element("details"));
    assert.equal(page.announced(), "");
  });
}

void test("in Studio, focus outside the preview stays where it is", async (t) => {
  const page = await openPage(t, "https://site.test/", { studio: true });
  const link = page.element("to-about");
  link.focus();
  // Focus is on the Studio's own controls.
  t.mock.method(page.viewport().document, "hasFocus", () => false);

  await page.click("to-about");

  assert.equal(page.focused(), link);
  assert.equal(page.announced(), "Title of /about", "the page is read out all the same");
});

void test("a page in another locale gives the visitor's document that locale's language", async (t) => {
  const page = await openPage(t, "https://site.test/");
  page.window.document.documentElement.lang = "en";

  await page.click("to-german");

  assert.equal(page.window.document.documentElement.lang, "de");
});

void test("a page in another locale leaves the Studio's own document in its language", async (t) => {
  const page = await openPage(t, "https://site.test/", { studio: true });
  page.window.document.documentElement.lang = "en";

  await page.click("to-german");

  assert.equal(page.window.location.pathname, "/de/preise");
  assert.equal(page.window.document.documentElement.lang, "en");
});
