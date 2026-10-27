import assert from "node:assert/strict";
import { test } from "node:test";

import { queryKeys } from "@camox/api-contract/query-keys";
import { QueryClient } from "@tanstack/react-query";

import type { ApiClient } from "./api-client";
import { createDraftScope } from "./draft-scope";
import type { LocaleView } from "./locale-path";
import type { PageWithBlocks } from "./queries";
import { createStudioCache, reads } from "./studio-reads";

/** Every call an API stand-in received: the draft it named, the procedure and its input. */
type Call = { draft: string | null; procedure: string; input: unknown };

/** An API answering each procedure with `answers[procedure](input)`, recording every call. */
function fakeApi(answers: Record<string, (input: any) => unknown> = {}) {
  const calls: Call[] = [];
  /** The tag of the locale each call named, in order. */
  const locales: string[] = [];
  const clientFor = (draft: string | null, locale: LocaleView, path: string[] = []): unknown =>
    new Proxy(() => {}, {
      get: (_target, name) => clientFor(draft, locale, [...path, String(name)]),
      apply: async (_target, _this, [input]) => {
        const procedure = path.join(".");
        calls.push({ draft, procedure, input });
        locales.push(locale.tag);
        const answer = answers[procedure];
        if (!answer) throw new Error(`Unexpected call to ${procedure}`);
        return answer(input);
      },
    });
  return {
    calls,
    locales,
    api: (draft: string | null, locale: LocaleView) => clientFor(draft, locale) as ApiClient,
  };
}

function openCache(answers?: Record<string, (input: any) => unknown>, developmentMode = false) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const scope = createDraftScope({ queryClient, developmentMode });
  const { api, calls, locales } = fakeApi(answers);
  return {
    queryClient,
    scope,
    calls,
    locales,
    cache: createStudioCache({ queryClient, scope, api }),
  };
}

function file(id: string) {
  return { id, url: `https://cdn.test/${id}.png`, alt: "", filename: `${id}.png` };
}

function record(id: string, content: Record<string, unknown>, references?: unknown) {
  return { id, collectionId: "authors", label: id, content, references };
}

/** A page with one block whose reference links a record, which links another in turn. */
function pageWithLinkedRecords() {
  const nested = record("team", { logo: { _fileId: "team-logo" } });
  const author = record("ada", { portrait: { _fileId: "portrait" } }, { team: nested });
  return {
    page: { id: "page-1", blockIds: ["block-1"] },
    layout: null,
    projectName: "Site",
    project: { id: 1 },
    blocks: [
      {
        id: "block-1",
        type: "quote",
        content: { photo: { _fileId: "block-photo" } },
        settings: {},
        references: { author },
      },
    ],
    repeatableItems: [
      {
        id: "item-1",
        blockId: "block-1",
        content: {},
        settings: {},
        references: { authors: [record("grace", { portrait: { _fileId: "item-portrait" } })] },
      },
    ],
    files: ["block-photo", "portrait", "team-logo", "item-portrait", "unused"].map(file),
  } as unknown as PageWithBlocks;
}

const home = reads.pageStructure({ path: "/", projectUuid: "site" });

void test("a page read in full fills each block's bundle with the files of the records its block and items link", () => {
  const { cache } = openCache();

  const structure = cache.land(home, pageWithLinkedRecords(), { in: null });

  assert.deepEqual(structure.page, { id: "page-1", blockIds: ["block-1"] });
  assert.equal("blocks" in structure, false, "the structure leaves the blocks to their reads");
  const bundle = cache.get(reads.blockBundle("block-1"), { in: null })!;
  assert.deepEqual(bundle.files.map((f) => f.id).sort(), [
    "block-photo",
    "item-portrait",
    "portrait",
    "team-logo",
  ]);
  assert.equal(bundle.repeatableItems.length, 1);
  assert.ok(cache.get(reads.file("team-logo"), { in: null }));
});

void test("a read landed in a draft fills that draft's reads, never Live's", () => {
  const { cache } = openCache();

  cache.land(home, pageWithLinkedRecords(), { in: "d1" });

  assert.ok(cache.get(reads.blockBundle("block-1"), { in: "d1" }));
  assert.equal(cache.get(reads.blockBundle("block-1"), { in: null }), undefined);
});

void test("reads are keyed under the draft the studio views, and shared reads under none", () => {
  const { cache, scope } = openCache();
  scope.adopt({ draftId: "d1" });

  const key = cache.options(reads.blockBundle("b")).queryKey;
  assert.deepEqual(key.slice(0, queryKeys.blocks.get("b").length), queryKeys.blocks.get("b"));
  assert.equal(key.at(-1), "d1");
  assert.deepEqual(cache.options(reads.project({ projectUuid: "site" })).queryKey, [
    "camox",
    "projects",
    "getByUuid",
    "site",
  ]);
  assert.deepEqual(cache.options(reads.draft({ projectId: 1, draftId: "d2" })).queryKey, [
    ...queryKeys.drafts.get,
    "d2",
  ]);
});

const en: LocaleView = { tag: "en", isDefault: true };
const de: LocaleView = { tag: "de", isDefault: false };

void test("localizations share their original's id, but each locale's read has its own key", () => {
  const { cache, scope } = openCache();
  scope.adopt({ draftId: "d1", locale: en });
  const inDefault = cache.options(reads.blockBundle("b")).queryKey;

  scope.adopt({ draftId: "d1", locale: de });
  const inGerman = cache.options(reads.blockBundle("b")).queryKey;

  assert.notDeepEqual(inGerman, inDefault);
  assert.equal(inGerman.at(-1), "d1", "the scope stays a key's last segment");
  assert.deepEqual(cache.options(reads.blockBundle("b"), { locale: en }).queryKey, inDefault);
  assert.equal(reads.blockBundle.paramsOf(inGerman), "b");
});

void test("a read fetches in the locale its key names, even once the studio moved to another", async () => {
  const { cache, scope, locales } = openCache({
    "blocks.get": ({ id }) => ({ block: { id }, repeatableItems: [], files: [] }),
  });
  scope.adopt({ locale: de });
  const options = cache.options(reads.blockBundle("b"));

  scope.adopt({ locale: en });
  await options.queryFn({ signal: new AbortController().signal });

  assert.deepEqual(locales, ["de"]);
});

void test("route discovery reads the locale its key names, which only a non-default locale names", async () => {
  const queryClient = new QueryClient();
  const scope = createDraftScope({ queryClient, developmentMode: false });
  const named: Array<string | undefined> = [];
  const cache = createStudioCache({
    queryClient,
    scope,
    api: fakeApi().api,
    runtimeJson: async (_endpoint, _base, _params, _draft, _signal, locale) => {
      named.push(locale && !locale.isDefault ? locale.tag : undefined);
      return Response.json({ path: "/articles/hallo" });
    },
  });
  const discovery = reads.discoveredPath({
    projectUuid: "site",
    runtimeBasePath: "",
    layoutId: "articles.$slug",
  });

  assert.equal(await cache.ensure(discovery, { locale: de }), "/articles/hallo");
  await cache.ensure(discovery, { locale: en });

  assert.deepEqual(named, ["de", undefined]);
});

void test("a server render keys its reads in the locale it renders, as the browser showing it does", () => {
  const server = openCache();
  const serverCache = createStudioCache({
    queryClient: server.queryClient,
    scope: server.scope,
    api: fakeApi().api,
    locale: () => de,
  });
  const browser = openCache();
  browser.scope.adopt({ locale: de });

  assert.deepEqual(
    serverCache.options(reads.blockBundle("b")).queryKey,
    browser.cache.options(reads.blockBundle("b")).queryKey,
  );
});

void test("a read fetches the draft its key names, even once the studio moved to another", async () => {
  const { cache, scope, calls } = openCache({
    "blocks.get": ({ id }) => ({ block: { id }, repeatableItems: [], files: [] }),
  });
  scope.adopt({ draftId: "d1" });
  const options = cache.options(reads.blockBundle("b"));

  scope.adopt({ draftId: "d2" });
  await options.queryFn({ signal: new AbortController().signal });

  assert.deepEqual(
    calls.map((call) => call.draft),
    ["d1"],
  );
});

void test("a draft's review reads that draft, whatever draft the studio views", async () => {
  const { cache, calls } = openCache({ "drafts.previewPublish": () => ({ changes: [] }) });

  await cache.ensure(reads.publishPreview({ projectId: 1, draftId: "d2" }));

  assert.deepEqual(calls, [
    { draft: "d2", procedure: "drafts.previewPublish", input: { projectId: 1 } },
  ]);
});

void test("ensuring a page loads it in full only when absent", async () => {
  const { cache, calls } = openCache({ "pages.getByPath": () => pageWithLinkedRecords() });

  await cache.ensure(home);
  await cache.ensure(home);

  assert.deepEqual(
    calls.map((call) => call.procedure),
    ["pages.getByPath"],
  );
  assert.ok(cache.get(reads.blockBundle("block-1")), "its blocks are filled in");
});

void test("an optimistic change rolls back to what each read held, forgetting reads it created", () => {
  const { cache } = openCache();
  const bundle = reads.blockBundle("b");
  const added = reads.blockBundle("added");
  cache.set(bundle, { block: { id: "b", title: "Before" } } as never);

  const edit = cache.edit();
  edit.set(bundle, { block: { id: "b", title: "After" } } as never);
  edit.set(added, { block: { id: "added" } } as never);
  assert.deepEqual(cache.get(bundle), { block: { id: "b", title: "After" } });
  edit.rollback();

  assert.deepEqual(cache.get(bundle), { block: { id: "b", title: "Before" } });
  assert.equal(cache.get(added), undefined);
});

void test("settling an optimistic change refreshes the reads it touched, in the draft it was made in", () => {
  const { cache, queryClient, scope } = openCache();
  scope.adopt({ draftId: "d1" });
  const bundle = reads.blockBundle("b");
  cache.set(bundle, { block: { id: "b" } } as never);
  cache.set(reads.blockBundle("other"), { block: { id: "other" } } as never);

  const edit = cache.edit();
  edit.set(bundle, { block: { id: "b", title: "After" } } as never);
  scope.adopt({ draftId: "d2" });
  edit.settle();

  const state = (draft: string, id: string) =>
    queryClient.getQueryState(cache.options(reads.blockBundle(id), { in: draft }).queryKey);
  assert.equal(state("d1", "b")?.isInvalidated, true);
  assert.equal(state("d1", "other")?.isInvalidated, false);
});

/** What the API broadcasts: the key prefixes its invalidations name (apps/api). */
const BROADCAST_PREFIXES = [
  queryKeys.pages.getByPathAll,
  queryKeys.pages.list,
  queryKeys.pages.getById(""),
  queryKeys.blocks.getUsageCounts,
  queryKeys.blocks.getPageMarkdown(""),
  queryKeys.blocks.get(""),
  queryKeys.files.list,
  queryKeys.files.get(""),
  queryKeys.layouts.all,
  queryKeys.drafts.all,
  queryKeys.patrol.get,
  queryKeys.collections.records("", ""),
  queryKeys.collections.record("", "", ""),
].map((prefix) => prefix.filter((segment) => segment !== ""));

/** Reads realtime doesn't need to reach: the same for every viewer, or code-owned. */
const UNREACHED = new Set(["project", "collectionList", "collection"]);
/**
 * Reads only the API's refresh of everything a scope reads reaches, as a change to a locale, to
 * an exclusion or to definitions does.
 */
const REACHED_BROADLY = new Set(["localeList", "missingFromLocale", "blockDefinitionList"]);

void test("realtime reaches every read: each key sits under a prefix the API broadcasts", () => {
  const params = new Proxy({}, { get: () => "x" });
  for (const [name, entry] of Object.entries(reads)) {
    if (UNREACHED.has(name) || REACHED_BROADLY.has(name)) continue;
    const key = entry.definition.key(params as never);
    const reached = BROADCAST_PREFIXES.some((prefix) =>
      prefix.every((segment, index) => key[index] === segment),
    );
    assert.ok(reached, `${name}: ${JSON.stringify(key)}`);
  }
});

void test("a block bundle's key names its block, and no other read's does", () => {
  const { cache } = openCache();

  assert.equal(reads.blockBundle.paramsOf(cache.options(reads.blockBundle("b")).queryKey), "b");
  assert.equal(reads.blockBundle.paramsOf(cache.options(reads.file("b")).queryKey), null);
});
