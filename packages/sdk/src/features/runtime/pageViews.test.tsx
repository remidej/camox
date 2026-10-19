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

void test("a visitor's page sends one GA4 page view even when React runs its effects twice", async (t) => {
  const page = await openPage(t, "https://site.test/pricing", { analytics: GA4, strictMode: true });
  await page.settle();
  assert.equal(pageViews(page.gtagCalls).length, 1);
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

void test("a visitor's navigation to another page sends one more GA4 page view, with the new page's path and title", async (t) => {
  const page = await openPage(t, "https://site.test/pricing", { analytics: GA4 });
  await page.settle();
  await page.click("to-about");
  assert.deepEqual(pageViews(page.gtagCalls).slice(1), [
    [
      "event",
      "page_view",
      {
        page_location: "https://site.test/about",
        page_path: "/about",
        page_title: titleOf("/about"),
      },
    ],
  ]);
});

void test("Back and Forward each send one GA4 page view, with the page they return to", async (t) => {
  const page = await openPage(t, "https://site.test/pricing", { analytics: GA4 });
  await page.settle();
  const pricing = page.window.history.state;
  await page.click("to-about");
  const about = page.window.history.state;
  const sentBefore = pageViews(page.gtagCalls).length;

  await page.traverse("/pricing", pricing);
  await page.traverse("/about", about);

  assert.deepEqual(
    pageViews(page.gtagCalls)
      .slice(sentBefore)
      .map(([, , params]) => params),
    [
      {
        page_location: "https://site.test/pricing",
        page_path: "/pricing",
        page_title: titleOf("/pricing"),
      },
      {
        page_location: "https://site.test/about",
        page_path: "/about",
        page_title: titleOf("/about"),
      },
    ],
  );
});

void test("a hash-only change on the same page sends no page view, even back from it", async (t) => {
  const page = await openPage(t, "https://site.test/pricing", { analytics: GA4 });
  await page.settle();
  const top = page.window.history.state;
  const sentBefore = pageViews(page.gtagCalls).length;
  await page.click("to-details");
  await page.click("to-pricing-details");
  await page.traverse("/pricing", top);
  assert.equal(page.shownPage(), "/pricing");
  assert.equal(pageViews(page.gtagCalls).length, sentBefore);
});

void test("a search-only change on the same page sends no page view, even back from it", async (t) => {
  const page = await openPage(t, "https://site.test/pricing", { analytics: GA4 });
  await page.settle();
  const top = page.window.history.state;
  const entries = page.window.history.length;
  const sentBefore = pageViews(page.gtagCalls).length;
  page.scrollBy(300);

  await page.click("to-pricing-plan");
  assert.equal(page.window.location.href, "https://site.test/pricing?plan=pro");
  assert.equal(page.window.history.length, entries + 1, "the link made a new entry");

  page.scrollBy(900);
  await page.traverse("/pricing", top);
  assert.equal(page.viewport().scrollY, 300, "Back restored the entry it returned to");

  assert.equal(page.shownPage(), "/pricing");
  assert.equal(pageViews(page.gtagCalls).length, sentBefore);
});

void test("the studio presentation sends no page view on navigation", async (t) => {
  const page = await openPage(t, "https://site.test/pricing", { analytics: GA4, studio: true });
  const pricing = page.window.history.state;
  await page.click("to-about");
  await page.traverse("/pricing", pricing);
  assert.equal(page.shownPage(), "/pricing");
  assert.deepEqual(page.gtagCalls, []);
});

void test("a render input without providers sends no page view on navigation", async (t) => {
  const page = await openPage(t, "https://site.test/pricing");
  const pricing = page.window.history.state;
  await page.click("to-about");
  await page.traverse("/pricing", pricing);
  assert.equal(page.shownPage(), "/pricing");
  assert.deepEqual(page.gtagCalls, []);
});
