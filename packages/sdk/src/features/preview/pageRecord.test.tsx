import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Window } from "happy-dom";
import { act } from "react";

import type { AnyLayoutLoaderResult } from "@/core/createLayout";
import { initApiClient } from "@/lib/api-client";
import { invalidateCollectionRecordViews } from "@/lib/collection-cache";
import { collectionQueries } from "@/lib/queries";

import { NavigationProvider, type NavigateOptions } from "../navigation/navigation";
import { useDerivedPageResult, useFollowPageRecord } from "./pageRecord";
import { previewStore } from "./previewStore";
import { refreshPublishedViews } from "./publication";

Object.assign(globalThis, { __CAMOX_TELEMETRY_DISABLED__: true });
initApiClient("http://localhost:8788", "development");

const record = (title: string): AnyLayoutLoaderResult => ({
  kind: "collection-item",
  collectionId: "articles",
  data: { id: "00000000-0000-4000-8000-000000000001", content: { title } },
});

/** Renders the record page's title as the preview loads it, against a site serving `titles`. */
async function renderPreview(t: TestContext, titles: { draft: string; live: string }) {
  const window = new Window({ url: "https://site.test/articles/hello" });
  Object.assign(globalThis, { window, document: window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const requests: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: URL) => {
    const url = new URL(input);
    requests.push(`${url.pathname}?${url.searchParams}`);
    const source = url.searchParams.get("source") as "draft" | "live";
    return Response.json({ derived: { result: record(titles[source]) } });
  });
  previewStore.send({ type: "reset" });
  const client = new QueryClient();
  const { createRoot } = await import("react-dom/client");
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  function Title() {
    const result = useDerivedPageResult({
      projectSlug: "site",
      runtimeBasePath: "",
      pathname: "/articles/hello",
      // What the server rendered the page with, for the editor's draft.
      loaded: { result: record("Server draft"), source: "draft" },
    });
    return <h1>{result?.kind === "collection-item" ? String(result.data.content.title) : ""}</h1>;
  }
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <Title />
      </QueryClientProvider>,
    ),
  );
  const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 10)));
  t.after(async () => {
    await act(async () => root.unmount());
    client.clear();
    previewStore.send({ type: "reset" });
    await window.happyDOM.close();
  });
  return { client, requests, settle, title: () => host.querySelector("h1")?.textContent };
}

const ARTICLE = { collectionId: "articles", id: "00000000-0000-4000-8000-000000000001" };

/** The Studio on a record page, against a site whose routes put the article at `articlePath`. */
async function renderRecordPage(t: TestContext, pathname: string) {
  const window = new Window({ url: `https://site.test${pathname}?zoom=2` });
  Object.assign(globalThis, { window, document: window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const site = { articlePath: pathname as string | null };
  const requests: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: URL) => {
    const url = new URL(input);
    requests.push(`${url.pathname}?${url.searchParams}`);
    return Response.json({ path: site.articlePath });
  });
  const navigations: NavigateOptions[] = [];
  const client = new QueryClient();
  const { createRoot } = await import("react-dom/client");
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  function Studio() {
    useFollowPageRecord({
      projectSlug: "site",
      runtimeBasePath: "",
      layoutId: "articles.$slug",
      record: ARTICLE,
    });
    return null;
  }
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <NavigationProvider
          location={{ pathname, href: `${pathname}?zoom=2`, search: "?zoom=2", hash: "" }}
          navigate={(options) => {
            navigations.push(options);
          }}
        >
          <Studio />
        </NavigationProvider>
      </QueryClientProvider>,
    ),
  );
  const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 10)));
  t.after(async () => {
    await act(async () => root.unmount());
    client.clear();
    await window.happyDOM.close();
  });
  /** A save of the article through any placement, as record edits store it. */
  const save = async (updatedAt: number, slug: string) => {
    site.articlePath = `/articles/${slug}`;
    await act(async () =>
      client.setQueryData(
        collectionQueries.record("site", ARTICLE.collectionId, ARTICLE.id).queryKey,
        { id: ARTICLE.id, content: { slug }, createdAt: 1000, updatedAt },
      ),
    );
    await settle();
  };
  return { requests, navigations, save };
}

void test("editing the slug of the previewed record moves the Studio to its new URL", async (t) => {
  const studio = await renderRecordPage(t, "/articles/hello");
  assert.deepEqual(studio.requests, [], "nothing is asked before the record changes");
  await studio.save(2000, "hello-world");
  assert.deepEqual(studio.requests, [
    `/_camox/routes?layoutId=articles.%24slug&recordId=${ARTICLE.id}`,
  ]);
  assert.deepEqual(studio.navigations, [
    { to: "/articles/hello-world?zoom=2", replace: true, source: "canvas" },
  ]);
});

void test("other edits of the previewed record leave the Studio where it is", async (t) => {
  const studio = await renderRecordPage(t, "/articles/hello");
  await studio.save(2000, "hello");
  assert.equal(studio.requests.length, 1);
  assert.deepEqual(studio.navigations, []);
});

void test("switching the preview to live content reloads the record page's data", async (t) => {
  const preview = await renderPreview(t, { draft: "Draft", live: "Published" });
  assert.equal(preview.title(), "Server draft");
  assert.deepEqual(preview.requests, []);
  await act(async () => previewStore.send({ type: "viewLiveSite" }));
  await preview.settle();
  assert.equal(preview.title(), "Published");
  assert.deepEqual(preview.requests, ["/_camox/data?path=%2Farticles%2Fhello&source=live"]);
  await act(async () => previewStore.send({ type: "viewDraftSite" }));
  await preview.settle();
  assert.equal(preview.title(), "Server draft");
});

void test("publishing or editing a record reloads the record page's data", async (t) => {
  const preview = await renderPreview(t, { draft: "Draft after publishing", live: "Published" });
  await act(() => refreshPublishedViews(preview.client));
  await preview.settle();
  assert.equal(preview.title(), "Draft after publishing");
  assert.deepEqual(preview.requests, ["/_camox/data?path=%2Farticles%2Fhello&source=draft"]);
  await act(() => invalidateCollectionRecordViews(preview.client, "site", "articles"));
  await preview.settle();
  assert.equal(preview.requests.length, 2);
});
