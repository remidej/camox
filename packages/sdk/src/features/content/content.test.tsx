import assert from "node:assert/strict";
import { test } from "node:test";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Type } from "@/core/createCollection";
import { NavigationProvider, useLocation } from "@/features/navigation/navigation";
import {
  collectionContentPath,
  editCollectionItemPath,
  matchCollectionContentPath,
  newCollectionItemPath,
  STUDIO_CONTENT_PATH,
} from "@/features/studio/routes";
import { initApiClient } from "@/lib/api-client";
import { AuthContext, createCamoxAuthClient } from "@/lib/auth";
import { collectionQueries, type CollectionDefinition } from "@/lib/queries";

import {
  collectionFormContent,
  collectionFormDefaults,
  collectionFormFields,
  type FieldSchema,
} from "./collection-form";
import { ContentSidebar } from "./components/ContentSidebar";
import { ContentCollection, ContentCollectionNew } from "./ContentCollection";

// tsx loads workspace UI sources with the classic JSX transform, unlike Vite.
Object.assign(globalThis, { React, __CAMOX_TELEMETRY_DISABLED__: true });
initApiClient("http://localhost:8788", "development");

const collections: CollectionDefinition[] = [
  { collectionId: "articles", title: "Articles", description: "News and updates", label: "title" },
  { collectionId: "authors", title: "Authors", description: "", label: "name" },
];

function withNavigation(children: React.ReactNode, pathname = STUDIO_CONTENT_PATH) {
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
      <QueryClientProvider client={client}>
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
      </QueryClientProvider>,
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
        STUDIO_CONTENT_PATH,
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
        client.setQueryData(collectionQueries.list("site").queryKey, collections);
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

void test("experimental UI enables collection browsing and the new-item form", async () => {
  const previous = Reflect.get(globalThis, "__CAMOX_ENABLE_EXPERIMENTAL_FEATURES__");
  const client = new QueryClient();
  try {
    Object.assign(globalThis, { __CAMOX_ENABLE_EXPERIMENTAL_FEATURES__: true });
    client.setQueryData(collectionQueries.list("site").queryKey, collections);
    client.setQueryData(collectionQueries.records("site", "articles").queryKey, []);
    client.setQueryData(collectionQueries.get("site", "articles").queryKey, {
      ...collections[0],
      contentSchema: { properties: { title: { fieldType: "String", default: "New article" } } },
    });
    const list = await renderContentPage(client, collectionContentPath("articles"));
    assert.match(list, /Collections/);
    assert.match(list, /Create item/);
    const form = await renderContentPage(client, newCollectionItemPath("articles"));
    assert.match(form, /New item/);
    assert.match(form, /New article/);
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
});

function renderCollection(collection: CollectionDefinition, client: QueryClient) {
  return renderToStaticMarkup(
    withNavigation(
      <QueryClientProvider client={client}>
        <ContentCollection projectSlug="site" collection={collection} />
      </QueryClientProvider>,
    ),
  );
}

void test("each empty collection has its own title and empty view", () => {
  const client = new QueryClient();
  for (const collection of collections) {
    client.setQueryData(collectionQueries.records("site", collection.collectionId).queryKey, []);
    const html = renderCollection(collection, client);
    assert.ok(html.includes(collection.title));
    assert.match(html, /No items yet/);
    assert.ok(html.includes(`Items in ${collection.title} will appear here.`));
    assert.doesNotMatch(html, /Loading items/);
    assert.equal(html.match(/href="[^"]*\/new"/g)?.length, 2);
  }
  client.clear();
});

void test("nonempty collections render record labels rather than an empty state", () => {
  const client = new QueryClient();
  client.setQueryData(collectionQueries.records("site", "articles").queryKey, [
    { id: "one", version: 1, label: "First article" },
    { id: "two", version: 1, label: "" },
  ]);
  const html = renderCollection(collections[0], client);
  assert.match(html, /First article/);
  assert.match(html, /aria-label="Delete First article"/);
  assert.match(html, /Untitled item/);
  assert.ok(html.includes(`href="${editCollectionItemPath("articles", "one")}"`));
  assert.ok(html.includes(`href="${editCollectionItemPath("articles", "two")}"`));
  assert.doesNotMatch(html, /No items yet/);
  assert.equal(html.match(/href="[^"]*\/new"/g)?.length, 2);
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
      queryKey: collectionQueries.records("site", "articles").queryKey,
      queryFn: () => Promise.reject(new Error("Offline")),
    }),
  );
  const html = renderCollection(collections[0], client);
  assert.match(html, /Could not load items/);
  assert.match(html, /Try again/);
  assert.doesNotMatch(html, /No items yet/);
  client.clear();
});

void test("collection query keys isolate projects, environments and collections", () => {
  const first = collectionQueries.records("site", "articles").queryKey;
  assert.notDeepEqual(first, collectionQueries.records("other-site", "articles").queryKey);
  assert.notDeepEqual(first, collectionQueries.records("site", "authors").queryKey);
  initApiClient("http://localhost:8788", "production");
  assert.notDeepEqual(first, collectionQueries.records("site", "articles").queryKey);
  initApiClient("http://localhost:8788", "development");
  assert.notDeepEqual(collectionQueries.get("site", "articles").queryKey, first);
  const record = collectionQueries.record("site", "articles", "one").queryKey;
  assert.notDeepEqual(record, collectionQueries.record("site", "articles", "two").queryKey);
  assert.notDeepEqual(record, collectionQueries.record("other-site", "articles", "one").queryKey);
  assert.notDeepEqual(record, collectionQueries.record("site", "authors", "one").queryKey);
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
  client.setQueryData(collectionQueries.get("site", "articles").queryKey, {
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
        cover: Type.Image({ title: "Cover" }),
        attachment: { fieldType: "File", accept: ["application/pdf"] },
        gallery: { fieldType: "ImageList" },
        documents: { fieldType: "FileList" },
      },
    },
  });
  const html = renderToStaticMarkup(
    withNavigation(
      <QueryClientProvider client={client}>
        <AuthContext.Provider
          value={{
            projectSlug: "site",
            apiUrl: "http://localhost:8788",
            authenticationUrl: "http://localhost:3290",
            authClient: createCamoxAuthClient("http://localhost:8788"),
          }}
        >
          <ContentCollectionNew projectSlug="site" collection={collections[0]} />
        </AuthContext.Provider>
      </QueryClientProvider>,
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

void test("asset preview defaults never enter collection form data", () => {
  const image = Type.Image({ title: "Cover" });
  const file = Type.File({ accept: ["application/pdf"] });
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

void test("collection form values round-trip assets and preserve unchanged rich text", () => {
  const fields: [string, FieldSchema][] = [
    ["title", { fieldType: "String" }],
    ["cover", { fieldType: "Image" }],
    ["gallery", { fieldType: "ImageList" }],
    ["category", { fieldType: "Enum", enum: ["news", "guide"] }],
  ];
  const asset = {
    url: "https://example.com/a.png",
    alt: "Cover",
    filename: "a.png",
    mimeType: "image/png",
    _fileId: "12",
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
  assert.equal((defaults.cover as { _fileId: number })._fileId, 12);
  assert.deepEqual(collectionFormContent(fields, defaults, original), original);
  assert.equal(
    collectionFormContent(fields, { ...defaults, title: "Changed" }, original).title,
    "Changed",
  );
  const uploaded = { ...asset, _fileId: 12, fileId: "12", id: 12, projectId: 3 };
  assert.deepEqual(
    collectionFormContent(fields, { ...defaults, cover: uploaded }, original).cover,
    asset,
  );
  assert.equal(collectionFormDefaults(fields).category, "news");
});

void test("collection forms create and edit drafts, invalidate lists, and retain values on failure", async (t) => {
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
            code: "CONFLICT",
            status: 409,
            message: "Record changed; reload before retrying",
          },
        },
        { status: 409 },
      );
    return Response.json({ json: { id, version: 3, draft: body.json.content } });
  });
  for (const editing of [false, true]) {
    const client = new QueryClient({
      defaultOptions: { queries: { staleTime: Infinity, retry: false } },
    });
    client.setQueryData(collectionQueries.get("site", "articles").queryKey, {
      ...collections[0],
      contentSchema: { properties: { title: { fieldType: "String", default: "New article" } } },
    });
    client.setQueryData(collectionQueries.records("site", "articles").queryKey, []);
    if (editing)
      client.setQueryData(collectionQueries.record("site", "articles", id).queryKey, {
        id,
        version: 2,
        draft: { title: "Existing article" },
      });
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
            <QueryClientProvider client={client}>
              <ContentCollectionNew
                projectSlug="site"
                collection={collections[0]}
                itemId={editing ? id : undefined}
              />
            </QueryClientProvider>
          </NavigationProvider>,
        );
      });
      assert.equal(host.textContent?.includes("Delete item"), false);
      assert.ok(host.querySelector("form")?.classList.contains("mx-auto"));
      const backLink = host.querySelector("a");
      assert.equal(backLink?.textContent?.trim(), editing ? "Edit item" : "New item");
      assert.equal(backLink?.getAttribute("href"), collectionContentPath("articles"));
      assert.ok(backLink?.classList.contains("justify-start"));
      const submit = async () => {
        await act(async () => {
          host
            .querySelector("form")!
            .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
          await new Promise((resolve) => setTimeout(resolve, 30));
        });
      };
      if (editing) {
        assert.ok(host.textContent?.includes("Edit item"));
        assert.equal(host.querySelector("textarea")?.value, "Existing article");
        fail = true;
        await submit();
        assert.match(host.querySelector('[role="alert"]')!.textContent!, /reload/);
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
        ...(editing ? { id, expectedVersion: 2 } : {}),
      });
      assert.deepEqual(navigations, [collectionContentPath("articles")]);
      assert.equal(
        client.getQueryState(collectionQueries.records("site", "articles").queryKey)?.isInvalidated,
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
    const [pathname, setPathname] = useState(STUDIO_CONTENT_PATH);
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
      await act(async () => link.click());
      assert.equal(host.querySelector('[aria-current="page"]')?.textContent, title);
      assert.equal(host.querySelectorAll('[aria-current="page"]').length, 1);
    }
  } finally {
    await act(async () => root.unmount());
    await window.happyDOM.close();
  }
});
