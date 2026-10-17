import assert from "node:assert/strict";
import { test } from "node:test";

import { QueryClient } from "@tanstack/react-query";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { contentFieldBuilder } from "@/core/lib/contentType";
import { NavigationProvider, useLocation } from "@/features/navigation/navigation";
import {
  collectionContentPath,
  editCollectionItemPath,
  matchCollectionContentPath,
  newCollectionItemPath,
  STUDIO_ASSETS_PATH,
  STUDIO_CONTENT_PATH,
} from "@/features/studio/routes";
import { initApiClient } from "@/lib/api-client";
import { AuthContext, createCamoxAuthClient } from "@/lib/auth";
import { type CollectionDefinition } from "@/lib/queries";

import {
  StudioQueryClientProvider,
  testDraftScope,
  readKey,
  testStudioCache,
} from "../../lib/draft-scope.fixtures";
import { reads } from "../../lib/studio-reads";
import {
  collectionFormContent,
  collectionFormDefaults,
  collectionFormFields,
  type FieldSchema,
} from "./collection-form";
import { CollectionItemModalProvider, useCollectionItemModal } from "./CollectionItemModalContext";
import { ContentSidebar } from "./components/ContentSidebar";
import { ContentCollection, ContentCollectionItemEditor } from "./ContentCollection";

// tsx loads workspace UI sources with the classic JSX transform, unlike Vite.
Object.assign(globalThis, { React, __CAMOX_TELEMETRY_DISABLED__: true });
initApiClient("http://localhost:8788", testDraftScope());

const collections: CollectionDefinition[] = [
  { collectionId: "articles", title: "Articles", description: "News and updates", label: "title" },
  { collectionId: "authors", title: "Authors", description: "", label: "name" },
];

function withNavigation(children: React.ReactNode, pathname = STUDIO_ASSETS_PATH) {
  return (
    <NavigationProvider
      location={{ pathname, href: `http://localhost:3001${pathname}`, search: "", hash: "" }}
      navigate={() => {}}
    >
      {children}
    </NavigationProvider>
  );
}

async function renderContentPage(client: QueryClient, pathname: string) {
  const { CamoxContent } = await import("./CamoxContent");
  return renderToStaticMarkup(
    withNavigation(
      <StudioQueryClientProvider client={client}>
        <AuthContext.Provider
          value={{
            projectSlug: "site",
            apiUrl: "http://localhost:8788",
            authenticationUrl: "http://localhost:3290",
            authClient: createCamoxAuthClient("http://localhost:8788"),
          }}
        >
          <CamoxContent />
        </AuthContext.Provider>
      </StudioQueryClientProvider>,
      pathname,
    ),
  );
}

void test("collections are hidden and not queried when experimental UI is unset or disabled", async () => {
  const previous = Reflect.get(globalThis, "__CAMOX_ENABLE_EXPERIMENTAL_FEATURES__");
  try {
    for (const flag of [undefined, false]) {
      if (flag === undefined)
        Reflect.deleteProperty(globalThis, "__CAMOX_ENABLE_EXPERIMENTAL_FEATURES__");
      else Object.assign(globalThis, { __CAMOX_ENABLE_EXPERIMENTAL_FEATURES__: flag });
      for (const pathname of [
        STUDIO_ASSETS_PATH,
        collectionContentPath("articles"),
        newCollectionItemPath("articles"),
      ]) {
        const client = new QueryClient();
        const html = await renderContentPage(client, pathname);
        assert.match(html, /Assets/);
        assert.doesNotMatch(html, /Collections|Articles|Create item|New item/);
        assert.equal(
          client
            .getQueryCache()
            .getAll()
            .some((query) => query.queryKey[1] === "collections"),
          false,
        );
        // Cached collection data must not bypass the feature gate either.
        testStudioCache(client).set(reads.collectionList({ projectSlug: "site" }), collections);
        assert.doesNotMatch(await renderContentPage(client, pathname), /Collections|Articles/);
        client.clear();
      }
    }
  } finally {
    if (previous === undefined)
      Reflect.deleteProperty(globalThis, "__CAMOX_ENABLE_EXPERIMENTAL_FEATURES__");
    else Object.assign(globalThis, { __CAMOX_ENABLE_EXPERIMENTAL_FEATURES__: previous });
  }
});

void test("content index does not render Assets before redirecting", async () => {
  const client = new QueryClient();
  try {
    assert.equal(await renderContentPage(client, STUDIO_CONTENT_PATH), "");
  } finally {
    client.clear();
  }
});

void test("the assets empty view offers a multi-file upload control", async () => {
  const client = new QueryClient();
  try {
    testStudioCache(client).set(reads.project({ slug: "site" }), {
      id: 1,
      slug: "site",
      name: "Site",
      deployToken: "",
      organizationId: "organization",
      organizationSlug: null,
      createdAt: 0,
      updatedAt: 0,
    });
    testStudioCache(client).set(reads.fileList({ projectId: 1 }), []);
    const html = await renderContentPage(client, STUDIO_ASSETS_PATH);
    assert.match(html, /No assets yet/);
    assert.match(html, /Upload images, videos, and files to use in your content/);
    assert.match(html, /Upload assets/);
    assert.match(html, /type="file"/);
    assert.match(html, /multiple=""/);
  } finally {
    client.clear();
  }
});

void test("experimental UI enables collection browsing and the new-item form", async () => {
  const previous = Reflect.get(globalThis, "__CAMOX_ENABLE_EXPERIMENTAL_FEATURES__");
  const client = new QueryClient();
  try {
    Object.assign(globalThis, { __CAMOX_ENABLE_EXPERIMENTAL_FEATURES__: true });
    testStudioCache(client).set(reads.collectionList({ projectSlug: "site" }), collections);
    testStudioCache(client).set(
      reads.records({ projectSlug: "site", collectionId: "articles" }),
      [],
    );
    testStudioCache(client).set(
      reads.collection({ projectSlug: "site", collectionId: "articles" }),
      {
        ...collections[0],
        contentSchema: { properties: { title: { fieldType: "String", default: "New article" } } },
      },
    );
    const list = await renderContentPage(client, collectionContentPath("articles"));
    assert.match(list, /Collections/);
    assert.match(list, /Create item/);
    const modalRoute = await renderContentPage(client, newCollectionItemPath("articles"));
    assert.match(modalRoute, /Articles/);
    assert.match(modalRoute, /No items yet/);
  } finally {
    client.clear();
    if (previous === undefined)
      Reflect.deleteProperty(globalThis, "__CAMOX_ENABLE_EXPERIMENTAL_FEATURES__");
    else Object.assign(globalThis, { __CAMOX_ENABLE_EXPERIMENTAL_FEATURES__: previous });
  }
});

void test("Collections group is absent when there are no collections", () => {
  const html = renderToStaticMarkup(
    withNavigation(
      <ContentSidebar collections={[]} selectedCollectionId={null} collectionsError={false} />,
    ),
  );
  assert.match(html, />Camox<\/h2>/);
  assert.match(html, /Assets/);
  assert.doesNotMatch(html, />Collections<\/h2>/);
});

void test("Collections group lists every collection in API order with one selected entry", () => {
  const html = renderToStaticMarkup(
    withNavigation(
      <ContentSidebar
        collections={collections}
        selectedCollectionId="authors"
        collectionsError={false}
      />,
    ),
  );
  assert.match(html, />Collections<\/h2>/);
  assert.ok(html.indexOf('title="Articles"') < html.indexOf('title="Authors"'));
  assert.equal(html.match(/aria-current="page"/g)?.length, 1);
  assert.match(html, /aria-current="page"[^]*?title="Authors"/);
  assert.match(html, /href="\/camox\/content\/collections\/authors"/);
  assert.equal(html.match(/lucide-list h-4 w-4 shrink-0 text-muted-foreground/g)?.length, 1);
});

function renderCollection(collection: CollectionDefinition, client: QueryClient) {
  return renderToStaticMarkup(
    withNavigation(
      <StudioQueryClientProvider client={client}>
        <CollectionItemModalProvider onRouteTargetClose={() => {}}>
          <ContentCollection projectSlug="site" collection={collection} />
        </CollectionItemModalProvider>
      </StudioQueryClientProvider>,
    ),
  );
}

void test("each empty collection has its own title and empty view", () => {
  const client = new QueryClient();
  for (const collection of collections) {
    testStudioCache(client).set(
      reads.records({ projectSlug: "site", collectionId: collection.collectionId }),
      [],
    );
    const html = renderCollection(collection, client);
    assert.ok(html.includes(collection.title));
    assert.match(html, /No items yet/);
    assert.ok(html.includes(`Items in ${collection.title} will appear here.`));
    assert.doesNotMatch(html, /Loading items/);
    assert.equal((html.match(/Create item/g) ?? []).length, 2);
  }
  client.clear();
});

void test("nonempty collections render record labels rather than an empty state", () => {
  const client = new QueryClient();
  testStudioCache(client).set(reads.records({ projectSlug: "site", collectionId: "articles" }), [
    { id: "one", label: "First article" },
    { id: "two", label: "" },
    { id: "three", label: "Edited article" },
  ]);
  const html = renderCollection(collections[0], client);
  assert.match(html, /First article<\/span><\/button>/);
  // Records have no publication status of their own.
  assert.doesNotMatch(html, /data-slot="badge"/);
  assert.doesNotMatch(html, />(Draft|Published|Modified|Publish)</);
  assert.match(html, /aria-label="Delete First article"/);
  assert.match(html, /Untitled item/);
  assert.doesNotMatch(html, /\/edit"/);
  assert.doesNotMatch(html, /No items yet/);
  assert.equal((html.match(/type="button"/g) ?? []).length > 0, true);
  assert.match(html, /Add item/);
  client.clear();
});

void test("loading and failures are not presented as an empty collection", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryOnMount: false } },
  });
  assert.match(renderCollection(collections[0], client), /Loading items/);
  await assert.rejects(
    client.fetchQuery({
      queryKey: readKey(reads.records({ projectSlug: "site", collectionId: "articles" })),
      queryFn: () => Promise.reject(new Error("Offline")),
    }),
  );
  const html = renderCollection(collections[0], client);
  assert.match(html, /Could not load items/);
  assert.match(html, /Try again/);
  assert.doesNotMatch(html, /No items yet/);
  client.clear();
});

void test("collection query keys isolate projects and collections", () => {
  const first = readKey(reads.records({ projectSlug: "site", collectionId: "articles" }));
  assert.notDeepEqual(
    first,
    readKey(reads.records({ projectSlug: "other-site", collectionId: "articles" })),
  );
  assert.notDeepEqual(
    first,
    readKey(reads.records({ projectSlug: "site", collectionId: "authors" })),
  );
  assert.notDeepEqual(
    readKey(reads.collection({ projectSlug: "site", collectionId: "articles" })),
    first,
  );
  const record = readKey(
    reads.record({
      projectSlug: "site",
      collectionId: "articles",
      id: "one",
    }),
  );
  assert.notDeepEqual(
    record,
    readKey(reads.record({ projectSlug: "site", collectionId: "articles", id: "two" })),
  );
  assert.notDeepEqual(
    record,
    readKey(reads.record({ projectSlug: "other-site", collectionId: "articles", id: "one" })),
  );
  assert.notDeepEqual(
    record,
    readKey(reads.record({ projectSlug: "site", collectionId: "authors", id: "one" })),
  );
});

void test("collection paths identify list and new routes, including encoded IDs", () => {
  const path = collectionContentPath("news & events");
  assert.deepEqual(matchCollectionContentPath(path), {
    collectionId: "news & events",
    isNew: false,
  });
  assert.deepEqual(matchCollectionContentPath(newCollectionItemPath("news & events")), {
    collectionId: "news & events",
    isNew: true,
  });
  assert.equal(matchCollectionContentPath("/camox/content/collections/%ZZ/new"), null);
  assert.deepEqual(matchCollectionContentPath(editCollectionItemPath("news & events", "item-id")), {
    collectionId: "news & events",
    isNew: false,
    itemId: "item-id",
  });
  assert.equal(matchCollectionContentPath("/camox/content/collections/articles/%ZZ/edit"), null);
});

void test("the new item route builds editable fields and media editors from the collection schema", () => {
  const client = new QueryClient();
  testStudioCache(client).set(reads.collection({ projectSlug: "site", collectionId: "articles" }), {
    ...collections[0],
    contentSchema: {
      properties: {
        title: { fieldType: "String", default: "New article", minLength: 1 },
        category: {
          fieldType: "Enum",
          default: "news",
          enum: ["news", "guide"],
          enumLabels: { news: "News", guide: "Guide" },
        },
        featured: { fieldType: "Boolean", default: false },
        cover: contentFieldBuilder.image({ title: "Cover" }),
        attachment: { fieldType: "File", accept: ["application/pdf"] },
        gallery: { fieldType: "ImageList" },
        documents: { fieldType: "FileList" },
      },
    },
  });
  const html = renderToStaticMarkup(
    withNavigation(
      <StudioQueryClientProvider client={client}>
        <AuthContext.Provider
          value={{
            projectSlug: "site",
            apiUrl: "http://localhost:8788",
            authenticationUrl: "http://localhost:3290",
            authClient: createCamoxAuthClient("http://localhost:8788"),
          }}
        >
          <ContentCollectionItemEditor
            projectSlug="site"
            collectionId="articles"
            onSaved={() => {}}
          />
        </AuthContext.Provider>
      </StudioQueryClientProvider>,
      newCollectionItemPath("articles"),
    ),
  );
  for (const label of ["Title", "Category", "Featured", "Cover"]) {
    assert.ok(html.includes(label), label);
  }
  assert.match(html, /New article/);
  assert.match(html, /News/);
  assert.match(html, /type="file"/);
  for (const kind of ["image", "file", "images", "files"]) {
    assert.ok(html.includes(`Select existing ${kind}`));
  }
  assert.equal((html.match(/Upload new/g) ?? []).length, 4);
  assert.match(html, /accept="application\/pdf"/);
  assert.doesNotMatch(html, /placehold\.co|placeholder\.png/);
  assert.doesNotMatch(html, /Saving items is not available yet/);
  assert.match(html, /type="submit"[^>]*>Create item/);
  assert.ok(html.indexOf('for="collection-title"') < html.indexOf('for="collection-category"'));
  client.clear();
});

void test("collection item controls open the shared create and edit modal", async () => {
  const { Window } = await import("happy-dom");
  const { act } = await import("react");
  const window = new Window();
  Object.assign(globalThis, {
    window,
    document: window.document,
    HTMLElement: window.HTMLElement,
    Element: window.Element,
    Node: window.Node,
    Event: window.Event,
    localStorage: window.localStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const { createRoot } = await import("react-dom/client");
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  testStudioCache(client).set(reads.collection({ projectSlug: "site", collectionId: "articles" }), {
    ...collections[0],
    contentSchema: { properties: { title: { fieldType: "String", default: "New article" } } },
  });
  testStudioCache(client).set(reads.records({ projectSlug: "site", collectionId: "articles" }), [
    { id: "one", label: "First article" },
  ]);
  testStudioCache(client).set(
    reads.record({ projectSlug: "site", collectionId: "articles", id: "one" }),
    {
      id: "one",
      content: { title: "Existing article" },
      createdAt: 1,
      updatedAt: 1,
    },
  );
  const host = document.createElement("div");
  const root = createRoot(host);
  function ModalTargetProbe() {
    const modal = useCollectionItemModal();
    return (
      <div>
        <output data-modal-target>
          {modal.target ? `${modal.target.collectionId}:${modal.target.itemId ?? "new"}` : "closed"}
        </output>
        <button type="button" onClick={modal.close}>
          Close modal
        </button>
      </div>
    );
  }
  try {
    await act(async () => {
      root.render(
        <StudioQueryClientProvider client={client}>
          <CollectionItemModalProvider onRouteTargetClose={() => {}}>
            <ContentCollection projectSlug="site" collection={collections[0]} />
            <ModalTargetProbe />
          </CollectionItemModalProvider>
        </StudioQueryClientProvider>,
      );
    });
    const createButton = [...host.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Create item",
    );
    assert.ok(createButton);
    await act(async () => createButton.click());
    assert.equal(host.querySelector("[data-modal-target]")?.textContent, "articles:new");

    const closeButton = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Close modal",
    );
    assert.ok(closeButton);
    await act(async () => closeButton.click());
    const editButton = [...host.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("First article"),
    );
    assert.ok(editButton);
    await act(async () => editButton.click());
    assert.equal(host.querySelector("[data-modal-target]")?.textContent, "articles:one");
  } finally {
    await act(async () => root.unmount());
    host.remove();
    client.clear();
    await window.happyDOM.close();
  }
});

void test("asset preview defaults never enter collection form data", () => {
  const image = contentFieldBuilder.image({ title: "Cover" });
  const file = contentFieldBuilder.file({ accept: ["application/pdf"] });
  const fields = collectionFormFields(
    {
      properties: {
        cover: image,
        attachment: file,
        gallery: { fieldType: "ImageList", default: [image.default] },
        documents: { fieldType: "FileList", default: [file.default] },
      },
    },
    "cover",
  );
  const empty = { cover: null, attachment: null, gallery: [], documents: [] };
  assert.deepEqual(collectionFormDefaults(fields), empty);
  assert.deepEqual(collectionFormDefaults(fields, empty), empty);
  assert.deepEqual(collectionFormContent(fields, collectionFormDefaults(fields)), empty);
});

void test("collection form reference values default unset and round-trip as record ids", () => {
  const fields: [string, FieldSchema][] = [
    ["title", { fieldType: "String" }],
    ["author", { fieldType: "Reference", collectionId: "authors" }],
    ["coauthors", { fieldType: "ReferenceList", collectionId: "authors" }],
  ];
  assert.deepEqual(collectionFormDefaults(fields), { title: "", author: null, coauthors: [] });
  const original = { title: "Launch", author: "jane", coauthors: ["sam", "ada"] };
  const defaults = collectionFormDefaults(fields, original);
  assert.deepEqual(defaults, original);
  assert.deepEqual(collectionFormContent(fields, defaults, original), original);
});

void test("collection form values round-trip assets and preserve unchanged rich text", () => {
  const fields: [string, FieldSchema][] = [
    ["title", { fieldType: "String" }],
    ["cover", { fieldType: "Image" }],
    ["gallery", { fieldType: "ImageList" }],
    ["category", { fieldType: "Enum", enum: ["news", "guide"] }],
  ];
  // Reads resolve a record's `{ _fileId }` to the file's metadata.
  const asset = {
    url: "https://example.com/a.png",
    alt: "Cover",
    filename: "a.png",
    mimeType: "image/png",
    size: 5,
    _fileId: "019a2b3c-4d5e-7f60-8a1b-2c3d4e5f6a0c",
  };
  const richText = {
    root: {
      type: "root",
      children: [{ type: "paragraph", children: [{ type: "text", text: "Hello" }] }],
    },
  };
  const original = { title: richText, cover: asset, gallery: [asset], category: "news" };
  const defaults = collectionFormDefaults(fields, original);
  assert.equal(defaults.title, "Hello");
  assert.equal(
    (defaults.cover as { _fileId: string })._fileId,
    "019a2b3c-4d5e-7f60-8a1b-2c3d4e5f6a0c",
  );
  const stored = {
    title: richText,
    cover: { _fileId: "019a2b3c-4d5e-7f60-8a1b-2c3d4e5f6a0c" },
    gallery: [{ _fileId: "019a2b3c-4d5e-7f60-8a1b-2c3d4e5f6a0c" }],
  };
  assert.deepEqual(collectionFormContent(fields, defaults, original), {
    ...stored,
    category: "news",
  });
  assert.equal(
    collectionFormContent(fields, { ...defaults, title: "Changed" }, original).title,
    "Changed",
  );
  const uploaded = {
    ...asset,
    _fileId: "019a2b3c-4d5e-7f60-8a1b-2c3d4e5f6a0d",
    fileId: "019a2b3c-4d5e-7f60-8a1b-2c3d4e5f6a0d",
    id: "019a2b3c-4d5e-7f60-8a1b-2c3d4e5f6a0d",
    projectId: 3,
  };
  assert.deepEqual(
    collectionFormContent(fields, { ...defaults, cover: uploaded }, original).cover,
    { _fileId: "019a2b3c-4d5e-7f60-8a1b-2c3d4e5f6a0d" },
  );
  // An asset that isn't a file reference is never stored.
  assert.equal(
    collectionFormContent(fields, { ...defaults, cover: { url: asset.url } }, original).cover,
    null,
  );
  assert.equal(collectionFormDefaults(fields).category, "news");
});

void test("collection forms create and edit records, invalidate lists, and retain values on failure", async (t) => {
  const { Window } = await import("happy-dom");
  const { act } = await import("react");
  const window = new Window({ url: "http://localhost:3000/" });
  Object.assign(globalThis, {
    window,
    document: window.document,
    HTMLElement: window.HTMLElement,
    Element: window.Element,
    Node: window.Node,
    Event: window.Event,
    localStorage: window.localStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  // In a draft already, so writes don't start one and switch the cached queries' keys.
  const inDraft = testDraftScope();
  inDraft.adopt({ draftId: "019a0000-0000-7000-8000-000000000001" });
  initApiClient("http://localhost:8788", inDraft);
  t.after(() => initApiClient("http://localhost:8788", testDraftScope()));
  const { createRoot } = await import("react-dom/client");
  const id = "a6479288-341f-4008-b118-dea6d8dd9158";
  const calls: { path: string; input: Record<string, unknown> }[] = [];
  let fail = false;
  t.mock.method(globalThis, "fetch", async (request: Request) => {
    const path = new URL(request.url).pathname;
    const body = (await request.json()) as { json: Record<string, unknown> };
    calls.push({ path, input: body.json });
    if (fail)
      return Response.json(
        {
          json: {
            defined: false,
            code: "BAD_REQUEST",
            status: 400,
            message: "Invalid content; fix and retry",
          },
        },
        { status: 400 },
      );
    return Response.json({
      json: { id, content: body.json.content, createdAt: 1, updatedAt: 2 },
    });
  });
  for (const editing of [false, true]) {
    const client = new QueryClient({
      defaultOptions: { queries: { staleTime: Infinity, retry: false } },
    });
    testStudioCache(client, { draftScope: inDraft }).set(
      reads.collection({ projectSlug: "site", collectionId: "articles" }),
      {
        ...collections[0],
        contentSchema: { properties: { title: { fieldType: "String", default: "New article" } } },
      },
    );
    testStudioCache(client, { draftScope: inDraft }).set(
      reads.records({ projectSlug: "site", collectionId: "articles" }),
      [],
    );
    if (editing)
      testStudioCache(client, { draftScope: inDraft }).set(
        reads.record({ projectSlug: "site", collectionId: "articles", id }),
        {
          id,
          content: { title: "Existing article" },
          createdAt: 1,
          updatedAt: 1,
        },
      );
    const host = document.createElement("div");
    const root = createRoot(host);
    const navigations: string[] = [];
    try {
      await act(async () => {
        root.render(
          <NavigationProvider
            navigate={({ to }) => {
              navigations.push(to);
            }}
          >
            <StudioQueryClientProvider client={client} draftScope={inDraft}>
              <ContentCollectionItemEditor
                projectSlug="site"
                collectionId="articles"
                itemId={editing ? id : undefined}
                onSaved={() => {
                  navigations.push(collectionContentPath("articles"));
                }}
              />
            </StudioQueryClientProvider>
          </NavigationProvider>,
        );
      });
      assert.ok(host.querySelector("form")?.classList.contains("mx-auto"));
      const submit = async () => {
        await act(async () => {
          host
            .querySelector("form")!
            .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
          await new Promise((resolve) => setTimeout(resolve, 30));
        });
      };
      if (editing) {
        assert.equal(host.querySelector("textarea")?.value, "Existing article");
        fail = true;
        await submit();
        assert.match(host.querySelector('[role="alert"]')!.textContent!, /fix and retry/);
        assert.equal(host.querySelector("textarea")?.value, "Existing article");
        assert.deepEqual(navigations, []);
      }
      fail = false;
      await submit();
      assert.ok(calls.length, host.textContent ?? "No request");
      const call = calls.at(-1)!;
      assert.ok(call.path.endsWith(editing ? "/editRecord" : "/createRecord"));
      assert.deepEqual(call.input, {
        projectSlug: "site",
        collectionId: "articles",
        content: { title: editing ? "Existing article" : "New article" },
        ...(editing ? { id } : {}),
      });
      assert.deepEqual(navigations, [collectionContentPath("articles")]);
      assert.equal(
        client.getQueryState(
          readKey(
            reads.records({ projectSlug: "site", collectionId: "articles" }),
            inDraft.current(),
          ),
        )?.isInvalidated,
        true,
      );
    } finally {
      await act(async () => root.unmount());
      host.remove();
      client.clear();
    }
  }
  await window.happyDOM.close();
});

void test("forms save the record without publishing, and refetches never replace unsaved values", async (t) => {
  const { Window } = await import("happy-dom");
  const { act } = await import("react");
  const window = new Window();
  Object.assign(globalThis, {
    window,
    document: window.document,
    HTMLElement: window.HTMLElement,
    Element: window.Element,
    Node: window.Node,
    Event: window.Event,
    localStorage: window.localStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const { createRoot } = await import("react-dom/client");
  const id = "a6479288-341f-4008-b118-dea6d8dd9158";
  for (const editing of [false, true]) {
    const calls: { path: string; input: Record<string, unknown> }[] = [];
    let failSave = true;
    t.mock.method(globalThis, "fetch", async (request: Request) => {
      const path = new URL(request.url).pathname;
      const { json: input } = (await request.json()) as { json: Record<string, unknown> };
      calls.push({ path, input });
      if (failSave)
        return Response.json(
          {
            json: {
              defined: false,
              code: "BAD_REQUEST",
              status: 400,
              message: "Invalid content",
            },
          },
          { status: 400 },
        );
      return Response.json({
        json: { id, content: input.content, createdAt: 1, updatedAt: 2 },
      });
    });
    const client = new QueryClient({
      defaultOptions: { queries: { staleTime: Infinity, retry: false } },
    });
    testStudioCache(client).set(
      reads.collection({ projectSlug: "site", collectionId: "articles" }),
      {
        ...collections[0],
        contentSchema: { properties: { title: { fieldType: "String", default: "Article" } } },
      },
    );
    if (editing)
      testStudioCache(client).set(
        reads.record({ projectSlug: "site", collectionId: "articles", id }),
        {
          id,
          content: { title: "Article" },
          createdAt: 1,
          updatedAt: 1,
        },
      );
    const host = document.createElement("div");
    const root = createRoot(host);
    const navigations: string[] = [];
    const submit = () =>
      act(async () => {
        host.querySelector("form")!.dispatchEvent(
          new window.SubmitEvent("submit", {
            bubbles: true,
            cancelable: true,
          }) as unknown as Event,
        );
        await new Promise((resolve) => setTimeout(resolve, 40));
      });
    try {
      await act(async () =>
        root.render(
          <NavigationProvider
            navigate={({ to }) => {
              navigations.push(to);
            }}
          >
            <StudioQueryClientProvider client={client}>
              <ContentCollectionItemEditor
                projectSlug="site"
                collectionId="articles"
                itemId={editing ? id : undefined}
                onSaved={() => {
                  navigations.push(collectionContentPath("articles"));
                }}
              />
            </StudioQueryClientProvider>
          </NavigationProvider>,
        ),
      );
      assert.equal(host.textContent?.includes("Cancel"), false);
      assert.equal(host.textContent?.includes("publish"), false);
      assert.equal(host.querySelectorAll('button[type="submit"]').length, 1);
      await submit();
      assert.equal(calls.length, 1);
      assert.match(host.querySelector('[role="alert"]')!.textContent!, /Could not save item/);
      assert.equal(host.querySelector("textarea")?.value, "Article");
      assert.deepEqual(navigations, []);
      // A refetch must not replace what the form is about to save.
      await act(async () =>
        testStudioCache(client).set(
          reads.record({ projectSlug: "site", collectionId: "articles", id }),
          {
            id,
            content: { title: "Someone else's edit" },
            createdAt: 1,
            updatedAt: 3,
          },
        ),
      );
      assert.equal(host.querySelector("textarea")?.value, "Article");
      failSave = false;
      await submit();
      assert.deepEqual(
        calls.map((call) => call.path.split("/").at(-1)),
        editing ? ["editRecord", "editRecord"] : ["createRecord", "createRecord"],
      );
      assert.deepEqual(calls.at(-1)!.input.content, { title: "Article" });
      assert.deepEqual(navigations, [collectionContentPath("articles")]);
      assert.deepEqual(
        testStudioCache(client).get(
          reads.record({ projectSlug: "site", collectionId: "articles", id }),
        )?.content,
        { title: "Article" },
      );
    } finally {
      await act(async () => root.unmount());
      client.clear();
    }
  }
  await window.happyDOM.close();
});

void test("sidebar selection follows navigation between collections and Assets", async () => {
  const { Window } = await import("happy-dom");
  const { act, useState } = await import("react");
  const window = new Window();
  Object.assign(globalThis, {
    window,
    document: window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const { createRoot } = await import("react-dom/client");
  const host = document.createElement("div");
  const root = createRoot(host);
  function Sidebar() {
    const pathname = useLocation({ select: (location) => location.pathname });
    return (
      <ContentSidebar
        collections={collections}
        selectedCollectionId={matchCollectionContentPath(pathname)?.collectionId ?? null}
        collectionsError={false}
      />
    );
  }
  function App() {
    const [pathname, setPathname] = useState(STUDIO_ASSETS_PATH);
    return (
      <NavigationProvider
        location={{ pathname, href: `http://localhost:3001${pathname}`, search: "", hash: "" }}
        navigate={({ to }) => setPathname(to)}
      >
        <Sidebar />
      </NavigationProvider>
    );
  }
  try {
    await act(async () => root.render(<App />));
    for (const title of ["Articles", "Authors", "Assets"]) {
      const link = [...host.querySelectorAll("a")].find((entry) => entry.textContent === title);
      assert.ok(link);
      if (title === "Assets") assert.equal(link.getAttribute("href"), STUDIO_ASSETS_PATH);
      await act(async () => link.click());
      assert.equal(host.querySelector('[aria-current="page"]')?.textContent, title);
      assert.equal(host.querySelectorAll('[aria-current="page"]').length, 1);
    }
  } finally {
    await act(async () => root.unmount());
    await window.happyDOM.close();
  }
});
