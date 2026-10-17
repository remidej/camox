import assert from "node:assert/strict";
import { test } from "node:test";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Window } from "happy-dom";
import * as React from "react";
import { renderToString } from "react-dom/server";

import { createApp } from "../../core/createApp";
import { createLayout, notFound, type LayoutLoaderResult } from "../../core/createLayout";
import { StudioScopeProvider } from "../../lib/draft-scope.fixtures";
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
            <StudioScopeProvider client={client}>
              <DerivedPageContent camoxApp={app} derived={input.derived!} />
            </StudioScopeProvider>
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
          projectName: "Real project",
          project: { id: 1, updatedAt: 1 },
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
          <StudioScopeProvider client={queryClient}>
            <PageNavigationProvider
              camoxApp={createApp({ blocks: [] })}
              initialInput={input}
              queryClient={queryClient}
            >
              {(current) => (
                <>
                  <CaptureNavigation />
                  <DerivedPageContent camoxApp={app} derived={current.derived!} />
                </>
              )}
            </PageNavigationProvider>
          </StudioScopeProvider>
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

function codeOwnedPagesApp() {
  const pokemon = createLayout("pokemon.$name")({
    ...options,
    title: "Pokémon",
    kind: "derived",
    loader: async ({ params }) => {
      if (params.name === "missingno") throw notFound();
      return { kind: "data", data: { name: params.name, flavor: "Electric mouse" } };
    },
    buildMetaTitle: ({ data, pageMetaTitle, projectName }) =>
      `${data.name} – ${pageMetaTitle} | ${projectName}`,
    buildMetaDescription: ({ data }) => data.flavor,
    toMarkdown: ({ data, params }) => [`# ${data.name}`, "", data.flavor, `/${params.name}`],
    component: () => null,
  });
  const types = createLayout("types.$name")({
    ...options,
    kind: "derived",
    loader: async () => ({ kind: "data", data: null }),
    component: () => null,
  });
  const about = createLayout("about")({
    ...options,
    kind: "singleton",
    toMarkdown: ({ data }) => [`# About ${String(data)}`],
    component: () => null,
  });
  return createApp({ blocks: [], layouts: [pokemon, types, about] });
}

function mockCodeOwnedPagesApi(t: { mock: { method: typeof test.mock.method } }) {
  const requested: string[] = [];
  t.mock.method(globalThis, "fetch", async (request: Request) => {
    const url = new URL(request.url);
    requested.push(url.pathname);
    if (url.pathname.endsWith("/getByPath")) {
      const { json } = (await request.json()) as { json: { path: string } };
      if (json.path === "/pokemon/curated") return Response.json({ json: { page: { id: 9 } } });
      return Response.json(
        { json: { defined: false, code: "NOT_FOUND", status: 404, message: "Not found" } },
        { status: 404 },
      );
    }
    if (url.pathname.endsWith("/getPageMarkdown"))
      return Response.json({ json: { markdown: "# Curated", blocks: [] } });
    if (url.pathname.endsWith("/getLayoutMarkdown"))
      return Response.json({
        json: { before: "<!-- Navbar -->\nNav", after: "<!-- Footer -->\nFooter" },
      });
    if (url.pathname.endsWith("/layouts/get"))
      return Response.json({
        json: {
          projectName: "Real project",
          project: { id: 1, updatedAt: 7 },
          layout: { id: 2, layoutId: "pokemon.$name", beforeBlockIds: [], afterBlockIds: [] },
          blocks: [],
          files: [],
          repeatableItems: [],
        },
      });
    throw new Error(`Unexpected request: ${url}`);
  });
  return requested;
}

void test("derived pages get the curated head, built from their loader data", async (t) => {
  mockCodeOwnedPagesApi(t);
  const app = codeOwnedPagesApp();
  const runtimeOptions: RuntimeOptions = {
    apiUrl: "https://api.test",
    authenticationUrl: "https://auth.test",
    projectSlug: "test",
    getCamoxApp: async () => app,
    renderPage: async () => "<main></main>",
  };
  const response = await handleCamoxRequest(
    new Request("https://site.test/pokemon/pikachu"),
    runtimeOptions,
  );
  const html = await response!.text();
  assert.match(html, /<title>pikachu – Pokémon \| Real project<\/title>/);
  assert.match(html, /<meta name="description" content="Electric mouse"/);
  assert.match(html, /<meta property="og:title" content="pikachu – Pokémon \| Real project"/);
  assert.match(html, /<meta property="og:description" content="Electric mouse"/);
  assert.match(
    html,
    /og:image" content="https:\/\/site.test\/og\?layoutId=pokemon.%24name&title=pikachu/,
  );
  assert.match(
    html,
    /<link rel="icon" href="https:\/\/api.test\/favicons\/1\?v=7&placeholder=camox"/,
  );

  // Client navigation receives the same head.
  const data = await handleCamoxRequest(
    new Request("https://site.test/_camox/data?path=/pokemon/pikachu"),
    runtimeOptions,
  );
  const input = (await data!.json()) as PageRenderInput;
  assert.deepEqual((input.head as { meta: Array<Record<string, string>> }).meta[0], {
    title: "pikachu – Pokémon | Real project",
  });
});

void test("code-owned pages answer Markdown between their live layout blocks", async (t) => {
  const requested = mockCodeOwnedPagesApi(t);
  const app = codeOwnedPagesApp();
  const markdown = (path: string) =>
    handleCamoxRequest(
      new Request(`https://site.test${path}`, { headers: { Accept: "text/markdown" } }),
      {
        apiUrl: "https://api.test",
        authenticationUrl: "https://auth.test",
        projectSlug: "test",
        getCamoxApp: async () => app,
        renderPage: async () => "<main>html</main>",
      },
    );

  const derived = await markdown("/pokemon/pikachu");
  assert.equal(derived?.headers.get("Content-Type"), "text/markdown; charset=utf-8");
  assert.equal(
    await derived!.text(),
    "<!-- Navbar -->\nNav\n\n# pikachu\n\nElectric mouse\n\n/pikachu\n\n<!-- Footer -->\nFooter",
  );

  requested.length = 0;
  const singleton = await markdown("/about");
  assert.equal(
    await singleton!.text(),
    "<!-- Navbar -->\nNav\n\n# About undefined\n\n<!-- Footer -->\nFooter",
  );
  assert.ok(!requested.some((path) => path.endsWith("/getByPath")), "Singletons skip page lookup");

  // A curated page at a derived URL keeps precedence, as for HTML.
  assert.equal(await (await markdown("/pokemon/curated"))!.text(), "# Curated");

  const missing = await markdown("/pokemon/missingno");
  assert.equal(missing?.status, 404);

  // Without toMarkdown, the page is HTML only.
  const html = await markdown("/types/electric");
  assert.match(await html!.text(), /<main>html<\/main>/);
});
