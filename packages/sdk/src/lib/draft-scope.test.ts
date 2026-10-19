import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEVELOPMENT_DRAFT,
  DRAFT_CREATE_HEADER,
  DRAFT_HEADER,
  type EndedDraft,
  LOCALE_HEADER,
} from "@camox/api-contract/drafts";
import { inScope, queryKeys } from "@camox/api-contract/query-keys";
import { QueryClient } from "@tanstack/react-query";

import type { DraftNotice } from "../features/routes/pageRuntime";
import { createDraftScope, type DraftScopeChange, draftNamedBy, withoutDraft } from "./draft-scope";

/**
 * A browser window's URL and history. It can't push entries, so every URL change the scope makes
 * replaces the current entry.
 */
function fakeBrowser(href: string) {
  const browser = {
    location: { href },
    history: {
      state: null,
      replaceState(_data: unknown, _unused: string, url?: string) {
        if (url) browser.location.href = new URL(url, browser.location.href).href;
      },
    },
  };
  return browser;
}

function openScope(href: string, { developmentMode = false } = {}) {
  const queryClient = new QueryClient();
  const browser = fakeBrowser(href);
  const draftScope = createDraftScope({ queryClient, browser, developmentMode });
  draftScope.adopt({ draftId: draftNamedBy(href) ?? undefined });
  const changes: DraftScopeChange[] = [];
  draftScope.subscribe((change) => changes.push(change));
  return { draftScope, queryClient, browser, changes };
}

const block = queryKeys.blocks.get("block-1");
const ended: EndedDraft = {
  draftId: "d1",
  outcome: "published",
  endedBy: { id: "user-1", name: "Ada" },
  endedAt: 1,
};

void test("each scope keeps its own draft, so concurrent server renders read their own keys", () => {
  const first = createDraftScope({ queryClient: new QueryClient(), developmentMode: false });
  const second = createDraftScope({ queryClient: new QueryClient(), developmentMode: false });

  first.adopt({ draftId: "d1" });

  assert.equal(first.current(), "d1");
  assert.equal(second.current(), null);
});

void test("the first content write on Live enters the draft it started once it succeeds, from what Live showed", () => {
  const { draftScope, queryClient, browser, changes } = openScope("https://site.test/about#hero");
  queryClient.setQueryData(inScope(block, null), { title: "Shown on Live" });
  queryClient.setQueryData(inScope(block, "other-draft"), { title: "Other draft" });

  const write = draftScope.requestHeaders(true);
  const draftId = write.headers[DRAFT_HEADER]!;
  assert.equal(write.headers[DRAFT_CREATE_HEADER], "1");
  assert.equal(draftScope.current(), null, "still Live until the write succeeds");
  write.settle(true);

  assert.equal(draftScope.current(), draftId);
  assert.equal(browser.location.href, `https://site.test/about?camox-draft=${draftId}#hero`);
  assert.deepEqual(changes, [{ draftId, move: "started" }]);
  assert.deepEqual(queryClient.getQueryData(inScope(block, draftId)), { title: "Shown on Live" });
  assert.deepEqual(draftScope.requestHeaders(true).headers, { [DRAFT_HEADER]: draftId });
});

void test("reads on Live name no draft, and a failed first write leaves the scope on Live", () => {
  const { draftScope, browser } = openScope("https://site.test/about");

  assert.deepEqual(draftScope.requestHeaders(false).headers, {});
  const write = draftScope.requestHeaders(true);
  write.settle(false);

  assert.equal(draftScope.current(), null);
  assert.equal(browser.location.href, "https://site.test/about");
  assert.notEqual(
    draftScope.requestHeaders(true).headers[DRAFT_HEADER],
    write.headers[DRAFT_HEADER],
  );
});

void test("links keep the viewed draft unless they name one or switch drafts", () => {
  const { draftScope } = openScope("https://site.test/about?camox-draft=d1");
  const from = "https://site.test/about?camox-draft=d1";

  assert.equal(
    draftScope.hrefFor("/contact?view=wide#top"),
    "/contact?view=wide&camox-draft=d1#top",
  );
  assert.equal(draftScope.hrefFor("/contact?camox-draft=d2"), "/contact?camox-draft=d2");
  assert.equal(draftScope.hrefFor(from, { draft: "d2" }), "https://site.test/about?camox-draft=d2");
  assert.equal(draftScope.hrefFor(from, { draft: null }), "https://site.test/about");
  assert.equal(draftScope.hrefFor("https://other.test/"), "https://other.test/");
});

void test("dev mode views the development draft, names it in every request, and leaves URLs alone", () => {
  const { draftScope, browser } = openScope("https://site.test/about?camox-draft=d1", {
    developmentMode: true,
  });

  assert.equal(draftScope.current(), DEVELOPMENT_DRAFT);
  assert.deepEqual(draftScope.requestHeaders(true).headers, { [DRAFT_HEADER]: DEVELOPMENT_DRAFT });
  assert.equal(draftScope.hrefFor("/contact"), "/contact");
  assert.equal(browser.location.href, "https://site.test/about?camox-draft=d1");
});

void test("a render that couldn't read its draft drops the param in place and tells the member why", () => {
  const { draftScope, browser } = openScope("https://site.test/about?camox-draft=d1");
  const notice: DraftNotice = { reason: "ended", ...ended };

  draftScope.adopt({ refusedDraft: { notice } });
  const notices: DraftNotice[] = [];
  draftScope.onNotice((heard) => notices.push(heard));

  assert.equal(draftScope.current(), null);
  assert.equal(browser.location.href, "https://site.test/about");
  assert.deepEqual(notices, [notice], "a notice raised before anyone listens waits");
});

void test("entering a scope marks what it cached when last shown as outdated, without refetching", () => {
  const { draftScope, queryClient } = openScope("https://site.test/about");
  queryClient.setQueryData(inScope(block, "d1"), { title: "Seen earlier" });
  queryClient.setQueryData(inScope(block, null), { title: "Live" });

  draftScope.adopt({ draftId: "d1" });

  assert.equal(queryClient.getQueryState(inScope(block, "d1"))?.isInvalidated, true);
  assert.equal(queryClient.getQueryState(inScope(block, null))?.isInvalidated, false);
});

void test("leaving an ended draft switches to Live in place, and says who ended it when asked", () => {
  const { draftScope, browser, changes } = openScope("https://site.test/about?camox-draft=d1");
  const notices: DraftNotice[] = [];
  draftScope.onNotice((notice) => notices.push(notice));

  draftScope.leave(ended, { notice: true });

  assert.equal(draftScope.current(), null);
  assert.equal(browser.location.href, "https://site.test/about");
  assert.deepEqual(changes, [{ draftId: null, move: "left" }]);
  assert.deepEqual(notices, [{ reason: "ended", ...ended }]);
});

void test("dev mode stays in its development draft after publishing or discarding it", () => {
  const { draftScope, changes } = openScope("https://site.test/about", { developmentMode: true });

  draftScope.leave(null);

  assert.equal(draftScope.current(), DEVELOPMENT_DRAFT);
  assert.deepEqual(changes, []);
});

void test("realtime reaches dev mode's queries by its development draft's id, looked up once", async () => {
  const queryClient = new QueryClient();
  let lookups = 0;
  const draftScope = createDraftScope({
    queryClient,
    developmentMode: true,
    loadDevelopmentDraftId: async () => {
      lookups++;
      return "dev-uuid";
    },
  });

  assert.equal(await draftScope.keyScopeOfDraft("dev-uuid", 1), DEVELOPMENT_DRAFT);
  assert.equal(await draftScope.keyScopeOfDraft("other", 1), "other");
  assert.equal(lookups, 1);
});

void test("a regular studio reaches a draft's queries by its id, without any lookup", async () => {
  const draftScope = createDraftScope({
    queryClient: new QueryClient(),
    developmentMode: false,
    loadDevelopmentDraftId: () => assert.fail("no development draft outside dev mode"),
  });

  assert.equal(await draftScope.keyScopeOfDraft("d1", 1), "d1");
});

void test("the draft param is read and removed only through the scope's helpers", () => {
  assert.equal(draftNamedBy("https://site.test/?camox-draft=d1"), "d1");
  assert.equal(draftNamedBy("/about"), null);
  assert.equal(withoutDraft("https://site.test/?a=1&camox-draft=d1"), "https://site.test/?a=1");
});

void test("a navigation on Live while the first write is in flight keeps the draft it starts", () => {
  const { draftScope } = openScope("https://site.test/about");
  const write = draftScope.requestHeaders(true);

  draftScope.adopt({});
  write.settle(true);

  assert.equal(draftScope.current(), write.headers[DRAFT_HEADER]);
});

void test("the first render shows what its own request read, without marking it outdated", () => {
  const queryClient = new QueryClient();
  queryClient.setQueryData(inScope(block, "d1"), { title: "Rendered in the draft" });
  const draftScope = createDraftScope({ queryClient, developmentMode: false });

  draftScope.adopt({ draftId: "d1" });

  assert.equal(draftScope.current(), "d1");
  assert.equal(queryClient.getQueryState(inScope(block, "d1"))?.isInvalidated, false);
});

void test("requests in a non-default locale name it, reads and writes alike; the default locale's name none", () => {
  const { draftScope } = openScope("https://site.test/de/preise?camox-draft=d1");
  const en = { tag: "en", isDefault: true };
  const de = { tag: "de", isDefault: false };

  draftScope.adopt({ draftId: "d1", locale: de });

  assert.deepEqual(draftScope.locale(), de);
  assert.deepEqual(draftScope.requestHeaders(false).headers, {
    [DRAFT_HEADER]: "d1",
    [LOCALE_HEADER]: "de",
  });
  assert.equal(draftScope.requestHeaders(true).headers[LOCALE_HEADER], "de");

  draftScope.adopt({ draftId: "d1", locale: en });
  assert.deepEqual(draftScope.requestHeaders(true).headers, { [DRAFT_HEADER]: "d1" });
});

void test("the first content write on Live in a non-default locale starts a draft in that locale", () => {
  const { draftScope } = openScope("https://site.test/de");
  draftScope.adopt({ locale: { tag: "de", isDefault: false } });

  const write = draftScope.requestHeaders(true);

  assert.equal(write.headers[DRAFT_CREATE_HEADER], "1");
  assert.equal(write.headers[LOCALE_HEADER], "de");
});
