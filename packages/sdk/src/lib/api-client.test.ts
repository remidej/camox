import assert from "node:assert/strict";
import { test } from "node:test";

import { DRAFT_CREATE_HEADER, DRAFT_HEADER, DRAFT_SEARCH_PARAM } from "@camox/api-contract/drafts";
import { Window } from "happy-dom";

const window = new Window({ url: "http://localhost:3000/about" });
Object.assign(globalThis, {
  window,
  localStorage: window.localStorage,
  __CAMOX_TELEMETRY_DISABLED__: true,
});
const { getApiClient, initApiClient } = await import("./api-client");

const UUIDV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

interface SentRequest {
  path: string;
  draft: string | null;
  create: string | null;
}

function mockApi(
  t: test.TestContext,
  respond: (path: string) => Response | Promise<Response> = () => okJson(null),
) {
  const sent: SentRequest[] = [];
  t.mock.method(globalThis, "fetch", async (request: Request) => {
    const path = new URL(request.url).pathname.replace(/^\/rpc\//, "");
    sent.push({
      path,
      draft: request.headers.get(DRAFT_HEADER),
      create: request.headers.get(DRAFT_CREATE_HEADER),
    });
    return respond(path);
  });
  return sent;
}

function okJson(json: unknown) {
  return new Response(JSON.stringify({ json }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function openStudio(url: string) {
  window.history.replaceState(null, "", url);
  initApiClient("http://api.test");
}

const blockEdit = () =>
  getApiClient().blocks.updateContent({ id: "block-1", content: { title: "Hi" } } as never);

void test("the first block edit on Live starts a draft and later block edits go to it", async (t) => {
  openStudio("/about?tab=seo#hero");
  const sent = mockApi(t);
  const historyLength = window.history.length;

  await blockEdit();
  const [first] = sent;
  assert.equal(first.path, "blocks/updateContent");
  assert.match(first.draft ?? "", UUIDV7);
  assert.equal(first.create, "1");

  const url = new URL(window.location.href);
  assert.equal(url.searchParams.get(DRAFT_SEARCH_PARAM), first.draft);
  assert.equal(url.pathname, "/about");
  assert.equal(url.searchParams.get("tab"), "seo");
  assert.equal(url.hash, "#hero");
  assert.equal(window.history.length, historyLength);

  await getApiClient().blocks.delete({ id: "block-1" } as never);
  assert.deepEqual(sent[1], { path: "blocks/delete", draft: first.draft, create: null });
});

void test("a failed first block edit leaves the studio on Live", async (t) => {
  openStudio("/about");
  let fail = true;
  const sent = mockApi(t, () =>
    fail
      ? new Response(JSON.stringify({ json: { message: "boom" } }), { status: 500 })
      : okJson(null),
  );

  await assert.rejects(blockEdit());
  assert.equal(new URL(window.location.href).searchParams.has(DRAFT_SEARCH_PARAM), false);

  await assert.rejects(getApiClient().pages.update({ id: "page-1" } as never));
  assert.deepEqual(sent[1], { path: "pages/update", draft: null, create: null });

  fail = false;
  await blockEdit();
  assert.equal(sent[2].create, "1");
  assert.notEqual(sent[2].draft, sent[0].draft);
});

void test("only block writes start a draft", async (t) => {
  openStudio("/about");
  const sent = mockApi(t);

  await getApiClient().pages.update({ id: "page-1" } as never);
  await getApiClient().repeatableItems.updateContent({ id: "item-1" } as never);
  await getApiClient().blocks.get({ id: "block-1" } as never);

  assert.deepEqual(
    sent.map(({ draft, create }) => ({ draft, create })),
    [
      { draft: null, create: null },
      { draft: null, create: null },
      { draft: null, create: null },
    ],
  );
  assert.equal(new URL(window.location.href).searchParams.has(DRAFT_SEARCH_PARAM), false);
});

void test("block edits fired before the draft exists all land in the same new draft", async (t) => {
  openStudio("/about");
  const sent = mockApi(t);

  await Promise.all([blockEdit(), getApiClient().blocks.updateSettings({ id: "b" } as never)]);

  assert.equal(sent.length, 2);
  assert.equal(sent[0].draft, sent[1].draft);
  assert.match(sent[0].draft ?? "", UUIDV7);
});

void test("a block edit that succeeds after another starting the same draft failed enters the draft", async (t) => {
  openStudio("/about");
  let answerSecond: (response: Response) => void = () => {};
  const secondAnswered = new Promise<Response>((resolve) => (answerSecond = resolve));
  let calls = 0;
  const sent = mockApi(t, () => {
    calls += 1;
    if (calls === 1)
      return new Response(JSON.stringify({ json: { message: "boom" } }), { status: 500 });
    return secondAnswered;
  });

  const first = blockEdit();
  const second = blockEdit();
  await assert.rejects(first);
  answerSecond(okJson(null));
  await second;

  assert.equal(sent[0].draft, sent[1].draft);
  assert.equal(new URL(window.location.href).searchParams.get(DRAFT_SEARCH_PARAM), sent[1].draft);
});

void test("a studio opened on a draft reads and writes it without creating it", async (t) => {
  const draftId = "01890a5d-ac96-774b-bcce-b302099a8057";
  openStudio(`/about?${DRAFT_SEARCH_PARAM}=${draftId}`);
  const sent = mockApi(t);

  await getApiClient().blocks.get({ id: "block-1" } as never);
  await blockEdit();

  assert.deepEqual(
    sent.map(({ draft, create }) => ({ draft, create })),
    [
      { draft: draftId, create: null },
      { draft: draftId, create: null },
    ],
  );
});

void test("a record edit on Live starts a draft, while reading records doesn't", async (t) => {
  openStudio("/about");
  const sent = mockApi(t);
  const records = getApiClient().collectionDefinitions;

  await records.listRecords({ projectSlug: "p", collectionId: "authors" });
  await records.editRecord({ projectSlug: "p", collectionId: "authors", id: "r" } as never);
  await records.deleteRecord({ projectSlug: "p", collectionId: "authors", id: "r" } as never);

  assert.deepEqual(sent[0], {
    path: "collectionDefinitions/listRecords",
    draft: null,
    create: null,
  });
  assert.match(sent[1].draft ?? "", UUIDV7);
  assert.equal(sent[1].create, "1");
  assert.deepEqual(sent[2], {
    path: "collectionDefinitions/deleteRecord",
    draft: sent[1].draft,
    create: null,
  });
  assert.equal(new URL(window.location.href).searchParams.get(DRAFT_SEARCH_PARAM), sent[1].draft);
});
