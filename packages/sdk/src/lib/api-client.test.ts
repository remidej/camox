import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEVELOPMENT_DRAFT,
  DRAFT_CREATE_HEADER,
  DRAFT_HEADER,
  DRAFT_SEARCH_PARAM,
  LOCALE_HEADER,
} from "@camox/api-contract/drafts";
import { Window } from "happy-dom";

const window = new Window({ url: "http://localhost:3000/about" });
Object.assign(globalThis, {
  window,
  localStorage: window.localStorage,
  __CAMOX_TELEMETRY_DISABLED__: true,
});
const { QueryClient } = await import("@tanstack/react-query");
const { getApiClient, getContentWriteHeaders, getDraftReadClient, initApiClient } =
  await import("./api-client");
const { createDraftScope } = await import("./draft-scope");

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

/** Opens the studio at `url`, viewing the draft it names, or in dev mode its development draft. */
function openStudio(url: string, { developmentMode = false } = {}) {
  window.history.replaceState(null, "", url);
  const draftScope = createDraftScope({
    queryClient: new QueryClient(),
    browser: window as never,
    developmentMode,
  });
  draftScope.adopt({
    draftId: new URL(window.location.href).searchParams.get(DRAFT_SEARCH_PARAM) ?? undefined,
  });
  initApiClient("http://api.test", draftScope);
  return draftScope;
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

  await assert.rejects(getApiClient().pages.get({ id: "page-1" } as never));
  assert.deepEqual(sent[1], { path: "pages/get", draft: null, create: null });

  fail = false;
  await blockEdit();
  assert.equal(sent[2].create, "1");
  assert.notEqual(sent[2].draft, sent[0].draft);
});

void test("page, repeatable item and synced content edits on Live start a draft like block edits", async (t) => {
  const writes = [
    () => getApiClient().pages.create({ projectId: 1 } as never),
    () => getApiClient().pages.update({ id: "page-1" } as never),
    () => getApiClient().pages.delete({ id: "page-1" } as never),
    () => getApiClient().pages.setLayout({ id: "page-1" } as never),
    () => getApiClient().pages.setSeo({ id: "page-1" } as never),
    () => getApiClient().repeatableItems.create({ blockId: "block-1" } as never),
    () => getApiClient().repeatableItems.updateContent({ id: "item-1" } as never),
    () => getApiClient().repeatableItems.updatePosition({ id: "item-1" } as never),
    () => getApiClient().repeatableItems.delete({ id: "item-1" } as never),
  ];
  for (const write of writes) {
    openStudio("/about");
    const sent = mockApi(t);

    await write();

    assert.match(sent[0].draft ?? "", UUIDV7, sent[0].path);
    assert.equal(sent[0].create, "1", sent[0].path);
    assert.equal(
      new URL(window.location.href).searchParams.get(DRAFT_SEARCH_PARAM),
      sent[0].draft,
      sent[0].path,
    );
    t.mock.restoreAll();
  }
});

void test("reads and generated values on Live start no draft", async (t) => {
  openStudio("/about");
  const sent = mockApi(t);

  await getApiClient().pages.list({ projectId: 1 } as never);
  await getApiClient().pages.generateSeo({ id: "page-1" } as never);
  await getApiClient().repeatableItems.get({ id: "item-1" } as never);
  await getApiClient().repeatableItems.generateSummary({ id: "item-1" } as never);
  await getApiClient().blocks.get({ id: "block-1" } as never);
  await getApiClient().blocks.getSyncedContent({ projectId: 1, type: "navbar" } as never);

  assert.deepEqual(
    sent.map(({ draft, create }) => ({ draft, create })),
    sent.map(() => ({ draft: null, create: null })),
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

void test("a studio viewing a non-default locale reads and edits that locale's localizations", async (t) => {
  const draftId = "01890a5d-ac96-774b-bcce-b302099a8057";
  const draftScope = openStudio(`/de/preise?${DRAFT_SEARCH_PARAM}=${draftId}`);
  draftScope.adopt({ draftId, locale: { tag: "de", isDefault: false } });
  const locales: (string | null)[] = [];
  t.mock.method(globalThis, "fetch", async (request: Request) => {
    locales.push(request.headers.get(LOCALE_HEADER));
    return okJson(null);
  });

  await blockEdit();
  await getDraftReadClient(draftId, draftScope.locale()).blocks.get({ id: "block-1" } as never);
  await getDraftReadClient(draftId, { tag: "en", isDefault: true }).blocks.get({
    id: "block-1",
  } as never);

  assert.deepEqual(locales, ["de", "de", null]);
});

void test("changing a file on Live starts a draft, and reading or generating metadata doesn't", async (t) => {
  openStudio("/about");
  const sent = mockApi(t);
  const fileId = "01890a5d-ac96-774b-bcce-b302099a8058";

  await getApiClient().files.get({ id: fileId } as never);
  await getApiClient().files.generateMetadata({ id: fileId } as never);
  assert.deepEqual(
    sent.map(({ draft }) => draft),
    [null, null],
  );

  await getApiClient().files.setAlt({ id: fileId, alt: "A mountain" } as never);
  assert.equal(sent[2].create, "1");
  assert.match(sent[2].draft ?? "", UUIDV7);
  assert.equal(new URL(window.location.href).searchParams.get(DRAFT_SEARCH_PARAM), sent[2].draft);
});

void test("an upload on Live asks for a new draft, and the studio enters it once it succeeds", async () => {
  openStudio("/about");
  const upload = getContentWriteHeaders();
  assert.equal(upload.headers[DRAFT_CREATE_HEADER], "1");
  const draftId = upload.headers[DRAFT_HEADER];
  assert.match(draftId ?? "", UUIDV7);
  upload.settle(true);

  assert.equal(new URL(window.location.href).searchParams.get(DRAFT_SEARCH_PARAM), draftId);
  assert.deepEqual(getContentWriteHeaders().headers, { [DRAFT_HEADER]: draftId });
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

void test("dev mode reads and writes the development draft and ignores the URL's draft", async (t) => {
  const draftId = "01890a5d-ac96-774b-bcce-b302099a8057";
  openStudio(`/about?${DRAFT_SEARCH_PARAM}=${draftId}`, { developmentMode: true });
  const sent = mockApi(t);

  await getApiClient().pages.get({ id: "page-1" } as never);
  await blockEdit();
  await getApiClient().files.setAlt({ id: "file-1", alt: "A mountain" } as never);

  assert.deepEqual(
    sent.map(({ draft, create }) => ({ draft, create })),
    sent.map(() => ({ draft: DEVELOPMENT_DRAFT, create: null })),
  );
  assert.deepEqual(getContentWriteHeaders().headers, { [DRAFT_HEADER]: DEVELOPMENT_DRAFT });
  assert.equal(new URL(window.location.href).searchParams.get(DRAFT_SEARCH_PARAM), draftId);
});

void test("dev mode never starts a draft or writes one to the URL", async (t) => {
  openStudio("/about", { developmentMode: true });
  const historyLength = window.history.length;
  const sent = mockApi(t);

  await blockEdit();

  assert.deepEqual(sent[0], {
    path: "blocks/updateContent",
    draft: DEVELOPMENT_DRAFT,
    create: null,
  });
  assert.equal(window.location.href, "http://localhost:3000/about");
  assert.equal(window.history.length, historyLength);
});

void test("dev mode shows Live where the page couldn't read the development draft, and starts no draft there", async (t) => {
  const draftScope = openStudio("/about", { developmentMode: true });
  draftScope.adopt({ refusedDraft: { notice: null } });
  const sent = mockApi(t);

  await getApiClient().pages.get({ id: "page-1" } as never);
  await blockEdit();
  assert.deepEqual(
    sent.map(({ draft, create }) => ({ draft, create })),
    [
      { draft: null, create: null },
      { draft: null, create: null },
    ],
  );
  assert.equal(new URL(window.location.href).searchParams.has(DRAFT_SEARCH_PARAM), false);

  // Once a page reads the development draft again, so does the studio.
  draftScope.adopt({ draftId: DEVELOPMENT_DRAFT });
  await getApiClient().pages.get({ id: "page-1" } as never);
  assert.equal(sent[2].draft, DEVELOPMENT_DRAFT);
});
