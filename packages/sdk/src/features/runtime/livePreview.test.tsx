import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

import { queryKeys } from "@camox/api-contract/query-keys";
import { Window } from "happy-dom";
import * as React from "react";

// Exercise the real chrome query subscription, without unrelated menus/styles.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("virtual:camox-"))
      return { url: 'data:text/javascript,export default "/studio.css"', shortCircuit: true };
    if (specifier === "../studio/components/Navbar")
      return { url: "data:text/javascript,export const Navbar = () => null", shortCircuit: true };
    if (specifier === "../preview/components/PreviewToolbar")
      return {
        url: "data:text/javascript,export const PreviewToolbar = () => null",
        shortCircuit: true,
      };
    return nextResolve(specifier, context);
  },
});

void test("live preview fetches after refreshing with only draft data cached", async () => {
  const window = new Window();
  Object.assign(globalThis, {
    window,
    document: window.document,
    location: window.location,
    localStorage: window.localStorage,
    HTMLElement: window.HTMLElement,
    Element: window.Element,
    Node: window.Node,
    MutationObserver: window.MutationObserver,
    IS_REACT_ACT_ENVIRONMENT: true,
    __CAMOX_TELEMETRY_DISABLED__: true,
    React,
  });

  const { createRoot } = await import("react-dom/client");
  const { QueryClient, QueryClientProvider, useSuspenseQuery } =
    await import("@tanstack/react-query");
  const { useSelector } = await import("@xstate/store-react");
  const { initApiClient, getApiClient } = await import("../../lib/api-client");
  const { previewStore } = await import("../preview/previewStore");
  const { RuntimeChrome } = await import("./RuntimeChrome");
  type PageRenderInput = import("./runtime").PageRenderInput;

  const draft = { page: { blockIds: [], nickname: "Draft content" }, layout: null };
  const live = { page: { blockIds: [], nickname: "Published content" }, layout: null };
  const requests: unknown[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (request) => {
    assert.ok(request instanceof Request);
    assert.match(request.url, /pages\/getStructure/);
    requests.push(await request.json());
    return Response.json({ json: live });
  };
  initApiClient("https://api.test");
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(queryKeys.pages.getByPath("/", "draft"), draft);
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const errors: unknown[] = [];

  class Boundary extends React.Component<React.PropsWithChildren, { failed: boolean }> {
    state = { failed: false };
    static getDerivedStateFromError() {
      return { failed: true };
    }
    componentDidCatch(error: unknown) {
      errors.push(error);
    }
    render() {
      return this.state.failed ? <div>Draft fallback</div> : this.props.children;
    }
  }

  function Preview() {
    const source = useSelector(previewStore, (state) => state.context.previewSource);
    const { data } = useSuspenseQuery({
      queryKey: queryKeys.pages.getByPath("/", source),
      queryFn: () => getApiClient().pages.getStructure({ path: "/", projectSlug: "test", source }),
      staleTime: Infinity,
    });
    return <div>{data.page.nickname}</div>;
  }

  try {
    await React.act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <RuntimeChrome input={{ pathname: "/", projectSlug: "test" } as PageRenderInput}>
            <Boundary>
              <React.Suspense fallback={<div>Loading live content</div>}>
                <Preview />
              </React.Suspense>
            </Boundary>
          </RuntimeChrome>
        </QueryClientProvider>,
      );
    });
    assert.match(host.textContent ?? "", /Draft content/);
    assert.equal(requests.length, 0);

    await React.act(async () => {
      previewStore.send({ type: "viewLivePage" });
    });
    await React.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
    assert.deepEqual(errors, []);
    assert.match(host.textContent ?? "", /Published content/);
    assert.doesNotMatch(host.textContent ?? "", /Draft/);
    assert.deepEqual(requests, [{ json: { path: "/", projectSlug: "test", source: "live" } }]);
  } finally {
    await React.act(async () => root.unmount());
    client.clear();
    globalThis.fetch = originalFetch;
    await window.happyDOM.close();
  }
});
