import assert from "node:assert/strict";
import { test } from "node:test";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { NavigationProvider, useLocation } from "@/features/navigation/navigation";
import {
  collectionContentPath,
  matchCollectionContentPath,
  newCollectionItemPath,
  STUDIO_CONTENT_PATH,
} from "@/features/studio/routes";
import { initApiClient } from "@/lib/api-client";
import { AuthContext, createCamoxAuthClient } from "@/lib/auth";
import { collectionQueries, type CollectionDefinition } from "@/lib/queries";

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
    { id: "one", label: "First article" },
    { id: "two", label: "" },
  ]);
  const html = renderCollection(collections[0], client);
  assert.match(html, /First article/);
  assert.match(html, /Untitled item/);
  assert.doesNotMatch(html, /No items yet/);
  assert.equal(html.match(/href="[^"]*\/new"/g)?.length, 1);
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
});

void test("the new item route builds fields from the collection schema without saving", () => {
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
        cover: { fieldType: "Image" },
      },
    },
  });
  const html = renderToStaticMarkup(
    withNavigation(
      <QueryClientProvider client={client}>
        <ContentCollectionNew projectSlug="site" collection={collections[0]} />
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
  assert.match(html, /Saving items is not available yet/);
  assert.match(html, /disabled=""/);
  assert.ok(html.indexOf('for="collection-title"') < html.indexOf('for="collection-category"'));
  client.clear();
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
