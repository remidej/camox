import assert from "node:assert/strict";
import { test } from "node:test";

import { openPage, titleOf } from "./pageNavigation.fixtures";

const GA4 = { ga4: { measurementId: "G-TEST123" }, posthog: null };
const POSTHOG = { ga4: null, posthog: { projectApiKey: "phc_test123", region: "eu" as const } };
const BOTH = { ga4: GA4.ga4, posthog: POSTHOG.posthog };

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
  const page = await openPage(t, "https://site.test/pricing", { analytics: BOTH, studio: true });
  await page.settle();
  assert.deepEqual(page.gtagCalls, []);
  assert.deepEqual(page.posthogCalls, []);
});

void test("a render input without providers sends no page view", async (t) => {
  const page = await openPage(t, "https://site.test/pricing");
  await page.settle();
  assert.deepEqual(page.gtagCalls, []);
  assert.deepEqual(page.posthogCalls, []);
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
  const page = await openPage(t, "https://site.test/pricing", { analytics: BOTH, studio: true });
  const pricing = page.window.history.state;
  await page.click("to-about");
  await page.traverse("/pricing", pricing);
  assert.equal(page.shownPage(), "/pricing");
  assert.deepEqual(page.gtagCalls, []);
  assert.deepEqual(page.posthogCalls, []);
});

void test("a render input without providers sends no page view on navigation", async (t) => {
  const page = await openPage(t, "https://site.test/pricing");
  const pricing = page.window.history.state;
  await page.click("to-about");
  await page.traverse("/pricing", pricing);
  assert.equal(page.shownPage(), "/pricing");
  assert.deepEqual(page.gtagCalls, []);
  assert.deepEqual(page.posthogCalls, []);
});

/** The page views sent to PostHog, by their properties. */
const posthogPageViews = (calls: unknown[][]) =>
  calls.filter(([event]) => event === "$pageview").map(([, properties]) => properties);

void test("a visitor's page sends one PostHog page view on first load, with its path and title", async (t) => {
  const page = await openPage(t, "https://site.test/pricing?plan=pro", { analytics: POSTHOG });
  await page.settle();
  assert.deepEqual(posthogPageViews(page.posthogCalls), [
    {
      $current_url: "https://site.test/pricing?plan=pro",
      $pathname: "/pricing",
      title: titleOf("/pricing"),
    },
  ]);
  assert.deepEqual(page.gtagCalls, [], "GA4 isn't set up");
});

void test("a visitor's navigations each send one PostHog page view, Back and Forward included, but not a hash-only change", async (t) => {
  const page = await openPage(t, "https://site.test/pricing", { analytics: POSTHOG });
  await page.settle();
  const pricing = page.window.history.state;
  await page.click("to-about");
  const about = page.window.history.state;
  await page.traverse("/pricing", pricing);
  await page.traverse("/about", about);
  await page.click("to-details");
  assert.equal(page.window.location.hash, "#details", "the hash-only link was followed");

  assert.deepEqual(posthogPageViews(page.posthogCalls), [
    {
      $current_url: "https://site.test/pricing",
      $pathname: "/pricing",
      title: titleOf("/pricing"),
    },
    { $current_url: "https://site.test/about", $pathname: "/about", title: titleOf("/about") },
    {
      $current_url: "https://site.test/pricing",
      $pathname: "/pricing",
      title: titleOf("/pricing"),
    },
    { $current_url: "https://site.test/about", $pathname: "/about", title: titleOf("/about") },
  ]);
});

void test("a search-only change on the same page sends no PostHog page view, even back from it", async (t) => {
  const page = await openPage(t, "https://site.test/pricing", { analytics: POSTHOG });
  await page.settle();
  const top = page.window.history.state;
  const sentBefore = posthogPageViews(page.posthogCalls).length;

  await page.click("to-pricing-plan");
  assert.equal(page.window.location.href, "https://site.test/pricing?plan=pro");
  await page.traverse("/pricing", top);

  assert.equal(page.shownPage(), "/pricing");
  assert.equal(posthogPageViews(page.posthogCalls).length, sentBefore);
});

void test("with GA4 and PostHog, each gets exactly one page view per page", async (t) => {
  const page = await openPage(t, "https://site.test/pricing", {
    analytics: BOTH,
    strictMode: true,
  });
  await page.settle();
  await page.click("to-about");

  assert.deepEqual(
    pageViews(page.gtagCalls).map(([, , params]) => (params as { page_path: string }).page_path),
    ["/pricing", "/about"],
  );
  assert.deepEqual(
    posthogPageViews(page.posthogCalls).map((view) => (view as { $pathname: string }).$pathname),
    ["/pricing", "/about"],
  );
});
