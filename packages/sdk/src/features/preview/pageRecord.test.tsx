import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";

import { QueryClient } from "@tanstack/react-query";
import { Window } from "happy-dom";
import { act } from "react";

import type { AnyLayoutLoaderResult } from "@/core/createLayout";
import { initApiClient } from "@/lib/api-client";
import { invalidateCollectionRecordViews } from "@/lib/collection-cache";

import {
  StudioQueryClientProvider,
  testDraftScope,
  testStudioCache,
} from "../../lib/draft-scope.fixtures";
import { reads } from "../../lib/studio-reads";
import { NavigationProvider, type NavigateOptions } from "../navigation/navigation";
import { useDerivedPageResult, useFollowPageRecord } from "./pageRecord";

Object.assign(globalThis, { __CAMOX_TELEMETRY_DISABLED__: true });
initApiClient("http://localhost:8788", testDraftScope());

const record = (title: string): AnyLayoutLoaderResult => ({
  kind: "collection-item",
  collectionId: "articles",
  data: { id: "00000000-0000-4000-8000-000000000001", content: { title } },
});

/** Renders the record page's title as the preview loads it, against a site serving `title`. */
async function renderPreview(t: TestContext, title: string) {
  const window = new Window({ url: "https://site.test/articles/hello" });
  Object.assign(globalThis, { window, document: window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const requests: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: URL) => {
    const url = new URL(input);
    requests.push(`${url.pathname}?${url.searchParams}`);
    return Response.json({ derived: { result: record(title) } });
  });
  const client = new QueryClient();
  // The server filled in the result it rendered the page with.
  const derivedPage = { projectSlug: "site", runtimeBasePath: "", pathname: "/articles/hello" };
  testStudioCache(client).set(reads.derivedPageData(derivedPage), record("Server draft"));
  const { createRoot } = await import("react-dom/client");
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  function Title() {
    const result = useDerivedPageResult({
      projectSlug: "site",
      runtimeBasePath: "",
      pathname: "/articles/hello",
      // What the server rendered the page with.
      loaded: { result: record("Server draft") },
    });
    return <h1>{result?.kind === "collection-item" ? String(result.data.content.title) : ""}</h1>;
  }
  await act(async () =>
    root.render(
      <StudioQueryClientProvider client={client}>
        <Title />
      </StudioQueryClientProvider>,
    ),
  );
  const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 10)));
  t.after(async () => {
    await act(async () => root.unmount());
    client.clear();
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
      <StudioQueryClientProvider client={client}>
        <NavigationProvider
          location={{ pathname, href: `${pathname}?zoom=2`, search: "?zoom=2", hash: "" }}
          navigate={(options) => {
            navigations.push(options);
          }}
        >
          <Studio />
        </NavigationProvider>
      </StudioQueryClientProvider>,
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
      testStudioCache(client).set(
        reads.record({ projectSlug: "site", collectionId: ARTICLE.collectionId, id: ARTICLE.id }),
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

void test("editing a record reloads the record page's data", async (t) => {
  const preview = await renderPreview(t, "Draft after editing");
  assert.equal(preview.title(), "Server draft");
  assert.deepEqual(preview.requests, []);
  await act(() =>
    invalidateCollectionRecordViews(testStudioCache(preview.client) as never, "site", "articles"),
  );
  await preview.settle();
  assert.equal(preview.title(), "Draft after editing");
  assert.deepEqual(preview.requests, ["/_camox/data?path=%2Farticles%2Fhello"]);
});
