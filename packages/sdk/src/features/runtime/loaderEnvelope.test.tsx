import assert from "node:assert/strict";
import { test } from "node:test";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Window } from "happy-dom";
import * as React from "react";
import { renderToString } from "react-dom/server";

import { createApp } from "../../core/createApp";
import { createLayout, notFound, type LayoutLoaderResult } from "../../core/createLayout";
import { useNavigate } from "../navigation/navigation";
import { DerivedPageContent } from "../page/DerivedPageContent";
import { readHydrationData } from "./hydrationData";
import { PageNavigationProvider } from "./pageNavigation";
import { handleCamoxRequest, type PageRenderInput, type RuntimeOptions } from "./runtime";

Object.assign(globalThis, { React });

const options = {
  title: "External data",
  description: "",
  blocks: { before: [], after: [] },
  buildMetaTitle: ({ pageMetaTitle }: { pageMetaTitle: string }) => pageMetaTitle,
};

void test("useData unwraps exactly once and preserves falsy payloads and no-loader layouts", () => {
  const layout = createLayout("values")({
    ...options,
    kind: "singleton",
    loader: (): LayoutLoaderResult<unknown> => ({ kind: "data", data: null }),
    component: Content,
  });
  function Content() {
    const data = layout.useData();
    return <output>{data === undefined ? "undefined" : JSON.stringify(data)}</output>;
  }
  for (const data of [null, false, 0, "", [], { kind: "data", data: "nested" }]) {
    const html = renderToString(
      <layout._internal.Provider layoutBlocks={{}} result={{ kind: "data", data }}>
        <Content />
      </layout._internal.Provider>,
    );
    const expected = renderToString(<output>{JSON.stringify(data)}</output>);
    assert.equal(html, expected);
  }
  assert.equal(
    renderToString(
      <layout._internal.Provider layoutBlocks={{}}>
        <Content />
      </layout._internal.Provider>,
    ),
    "<output>undefined</output>",
  );
  assert.throws(() => renderToString(<Content />), /useData must be rendered inside its Provider/);

  const staticLayout = createLayout("static")({
    ...options,
    kind: "singleton",
    component: StaticContent,
  });
  function StaticContent() {
    assert.equal(staticLayout.useData(), undefined);
    return <main>Static page</main>;
  }
  assert.equal(
    renderToString(
      <staticLayout._internal.Provider layoutBlocks={{}}>
        <StaticContent />
      </staticLayout._internal.Provider>,
    ),
    "<main>Static page</main>",
  );
});

void test("real rendering, hydration and client navigation preserve loader envelopes", async (t) => {
  let loaderCalls = 0;
  const layout = createLayout("pokemon.$name")({
    ...options,
    kind: "derived",
    loader: async ({ params }) => {
      loaderCalls++;
      return { kind: "data", data: { name: params.name, nested: { data: [0, false, null] } } };
    },
    component: Pokemon,
  });
  function Pokemon() {
    const pokemon = layout.useData();
    return (
      <output>
        {pokemon.name}:{JSON.stringify(pokemon.nested)}
      </output>
    );
  }
  const app = createApp({ blocks: [], layouts: [layout] });
  const runtimeOptions: RuntimeOptions = {
    apiUrl: "https://api.test",
    authenticationUrl: "https://auth.test",
    projectSlug: "test",
    getCamoxApp: async () => app,
    renderPage: async (input) => {
      assert.equal(input.derived?.result?.kind, "data");
      const client = new QueryClient();
      try {
        return renderToString(
          <QueryClientProvider client={client}>
            <DerivedPageContent camoxApp={app} derived={input.derived!} source={input.source} />
          </QueryClientProvider>,
        );
      } finally {
        client.clear();
      }
    },
  };
  t.mock.method(globalThis, "fetch", async (request: Request | URL) => {
    const url = request instanceof URL ? request : new URL(request.url);
    if (url.hostname === "site.test")
      return (await handleCamoxRequest(new Request(url), runtimeOptions))!;
    if (url.pathname.endsWith("/getByPath"))
      return Response.json(
        { json: { defined: false, code: "NOT_FOUND", status: 404, message: "Not found" } },
        { status: 404 },
      );
    if (url.pathname.endsWith("/layouts/get"))
      return Response.json({
        json: {
          layout: {
            id: 2,
            layoutId: "pokemon.$name",
            beforeBlockIds: [],
            afterBlockIds: [],
            updatedAt: "v1",
          },
          blocks: [],
          files: [],
          repeatableItems: [],
        },
      });
    throw new Error(`Unexpected request: ${url}`);
  });
  const response = await handleCamoxRequest(
    new Request("https://site.test/pokemon/pikachu"),
    runtimeOptions,
  );
  assert.equal(response?.status, 200);
  const html = await response!.text();
  assert.match(html, /<output>pikachu/);
  const window = new Window({ url: "https://site.test/pokemon/pikachu" });
  Object.assign(globalThis, {
    window,
    document: window.document,
    location: window.location,
    HTMLElement: window.HTMLElement,
    Element: window.Element,
    Node: window.Node,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  window.document.write(html);
  const input = readHydrationData<PageRenderInput>();
  assert.deepEqual(input.derived?.result, {
    kind: "data",
    data: { name: "pikachu", nested: { data: [0, false, null] } },
  });
  const queryClient = new QueryClient();
  const errors: unknown[] = [];
  const { hydrateRoot } = await import("react-dom/client");
  let navigate: ReturnType<typeof useNavigate>;
  function CaptureNavigation() {
    navigate = useNavigate();
    return null;
  }
  let root: ReturnType<typeof hydrateRoot> | undefined;
  try {
    await React.act(async () => {
      root = hydrateRoot(
        document.getElementById("root")!,
        <QueryClientProvider client={queryClient}>
          <PageNavigationProvider initialInput={input} queryClient={queryClient}>
            {(current) => (
              <>
                <CaptureNavigation />
                <DerivedPageContent
                  camoxApp={app}
                  derived={current.derived!}
                  source={current.source}
                />
              </>
            )}
          </PageNavigationProvider>
        </QueryClientProvider>,
        { onRecoverableError: (error) => errors.push(error) },
      );
    });
    assert.equal(loaderCalls, 1, "hydration does not run the server loader again");
    assert.match(document.querySelector("output")!.textContent, /pikachu/);
    await React.act(async () => {
      await navigate!({ to: "/pokemon/eevee" });
    });
    assert.match(document.querySelector("output")!.textContent, /eevee/);
    assert.equal(loaderCalls, 2);
    await React.act(async () => {
      await navigate!({ to: "/pokemon/eevee#details" });
    });
    assert.equal(loaderCalls, 2, "hash-only navigation reuses the current envelope");
    assert.match(document.querySelector("output")!.textContent, /eevee/);
    await React.act(async () => {
      await navigate!({ to: "/pokemon/pikachu" });
    });
    assert.match(document.querySelector("output")!.textContent, /pikachu/);
    assert.equal(loaderCalls, 3, "same-layout navigation does not reuse stale loader data");
    assert.deepEqual(errors, []);
  } finally {
    await React.act(async () => root?.unmount());
    queryClient.clear();
    await window.happyDOM.close();
  }
});

void test("loader notFound stays 404, other errors and invalid envelopes remain server failures", async () => {
  const failure = new Error("Upstream failed");
  for (const thrown of [notFound(), failure]) {
    const layout = createLayout("failure")({
      ...options,
      kind: "singleton",
      component: () => null,
      loader: () => {
        throw thrown;
      },
    });
    const app = createApp({ blocks: [], layouts: [layout] });
    const runtimeOptions: RuntimeOptions = {
      apiUrl: "https://api.test",
      projectSlug: "test",
      getCamoxApp: async () => app,
      renderPage: async () => "",
    };
    for (const path of ["/failure", "/_camox/data?path=/failure"]) {
      const response = handleCamoxRequest(new Request(`https://site.test${path}`), runtimeOptions);
      if (thrown === failure) {
        await assert.rejects(response, (error) => error === failure);
        continue;
      }
      assert.equal((await response)?.status, 404);
    }
  }
  for (const result of [
    undefined,
    null,
    { count: 1 },
    { kind: "data" },
    { kind: "data", data: undefined },
    { kind: "data", data: () => "not serializable" },
    { kind: "collection-item", data: {} },
  ]) {
    const layout = createLayout("invalid")({
      ...options,
      kind: "singleton",
      component: () => null,
      loader: () => result as LayoutLoaderResult,
    });
    const app = createApp({ blocks: [], layouts: [layout] });
    for (const path of ["/invalid", "/_camox/data?path=/invalid"]) {
      await assert.rejects(
        handleCamoxRequest(new Request(`https://site.test${path}`), {
          apiUrl: "https://api.test",
          projectSlug: "test",
          getCamoxApp: async () => app,
          renderPage: async () => "",
        }),
        /loader must return \{ kind: "data", data \}/,
      );
    }
  }
});
