import assert from "node:assert/strict";
import { test } from "node:test";

import { QueryClient, dehydrate } from "@tanstack/react-query";
import { Window } from "happy-dom";
import * as React from "react";

import { useLocation, useNavigate } from "../navigation/navigation";
import { PageNavigationProvider } from "./pageNavigation";
import type { PageRenderInput } from "./runtime";

for (const base of ["", "/mounted"]) {
  void test(`canvas preview navigation loads actual site routes (base: ${base || "/"})`, async (t) => {
    const window = new Window({ url: `https://site.test${base}/` });
    Object.assign(globalThis, {
      React,
      window,
      document: window.document,
      location: window.location,
      HTMLElement: window.HTMLElement,
      Element: window.Element,
      Node: window.Node,
      IS_REACT_ACT_ENVIRONMENT: true,
    });
    const scrollMock = t.mock.method(window, "scrollTo", () => {});
    document.head.innerHTML = "<title data-camox-page-head>Home</title>";
    document.body.innerHTML = '<div id="root"></div>';
    const queryClient = new QueryClient();
    const seed = new QueryClient();
    const input: PageRenderInput = {
      presentation: "studio",
      apiUrl: "https://api.test",
      authenticationUrl: "https://auth.test",
      projectSlug: "test",
      environmentName: "production",
      source: "draft",
      href: window.location.href,
      pathname: "/",
      runtimeBasePath: base,
      head: { meta: [{ title: "Home" }] },
      layoutIdentity: null,
      loaderData: null,
      dehydratedState: dehydrate(seed),
    };
    const fetchMock = t.mock.method(globalThis, "fetch", async (request: URL | RequestInfo) => {
      const url = new URL(request instanceof Request ? request.url : request);
      assert.equal(url.pathname, `${base}/_camox/data`);
      const pathname = url.searchParams.get("path")!;
      seed.setQueryData(["page", pathname], pathname);
      return new Response(
        JSON.stringify({
          ...input,
          pathname,
          head: { meta: [{ title: pathname }] },
          loaderData: { pathname },
          dehydratedState: dehydrate(seed),
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    let renderedInput = input;
    let navigate: ReturnType<typeof useNavigate>;
    let committedSource: "canvas" | undefined;
    let mounts = 0;
    let unmounts = 0;
    function Workspace() {
      navigate = useNavigate();
      const location = useLocation();
      committedSource = location.source;
      React.useEffect(() => {
        mounts++;
        return () => {
          unmounts++;
        };
      }, []);
      return (
        <output>
          {location.pathname}
          {location.search}
          {location.hash}
        </output>
      );
    }
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(document.getElementById("root")!);
    const assertLocation = (path: string, fetches: number) => {
      const pathname = new URL(path, "https://site.test").pathname;
      assert.equal(document.querySelector("output")!.textContent, path);
      assert.equal(window.location.href, `https://site.test${base}${path}`);
      assert.equal(document.title, pathname);
      assert.equal(fetchMock.mock.callCount(), fetches);
      assert.equal(scrollMock.mock.callCount(), 0);
      assert.equal(queryClient.getQueryData(["page", pathname]), pathname);
      assert.deepEqual(renderedInput.loaderData, { pathname });
      assert.equal(renderedInput.pathname, pathname);
      assert.equal(renderedInput.href, window.location.href);
      assert.equal(mounts, 1);
      assert.equal(unmounts, 0);
    };
    try {
      await React.act(async () => {
        root.render(
          <PageNavigationProvider initialInput={input} queryClient={queryClient}>
            {(next) => {
              renderedInput = next;
              return <Workspace />;
            }}
          </PageNavigationProvider>,
        );
      });
      const push = t.mock.method(window.history, "pushState");
      const replace = t.mock.method(window.history, "replaceState");
      await React.act(async () => {
        await navigate!({ to: "/blog/hello%20world?view=wide#section" });
      });
      assertLocation("/blog/hello%20world?view=wide#section", 1);
      assert.equal(push.mock.callCount(), 1);
      await React.act(async () => {
        await navigate!({ to: "/about", replace: true, source: "canvas" });
      });
      assertLocation("/about", 2);
      assert.equal(committedSource, "canvas");
      assert.equal(window.history.state, null, "provenance is never persisted in history");
      assert.equal(replace.mock.callCount(), 1);
      await React.act(async () => {
        await navigate!({ to: "/about?view=wide#section", replace: true });
      });
      assertLocation("/about?view=wide#section", 2);
      assert.equal(committedSource, undefined);
      // Happy DOM does not implement history traversal: reproduce the browser's
      // URL update followed by popstate for back and forward.
      for (const [index, path] of ["/", "/about"].entries()) {
        window.history.replaceState(null, "", `${base}${path}`);
        const replacements = replace.mock.callCount();
        await React.act(async () => {
          window.dispatchEvent(new window.PopStateEvent("popstate"));
        });
        assertLocation(path, 3 + index);
        assert.equal(committedSource, undefined, "history traversal is external");
        assert.equal(push.mock.callCount(), 1);
        assert.equal(replace.mock.callCount(), replacements);
      }

      // A newer selection of the committed page cancels a pending different
      // page, even when the fetch implementation ignores its abort signal.
      let resolve!: (response: Response) => void;
      fetchMock.mock.mockImplementation(() => new Promise<Response>((done) => (resolve = done)));
      let pending!: Promise<void> | void;
      await React.act(async () => {
        pending = navigate!({ to: "/slow" });
        await navigate!({ to: "/about" });
      });
      await React.act(async () => {
        resolve(
          new Response(
            JSON.stringify({ ...input, pathname: "/slow", dehydratedState: dehydrate(seed) }),
          ),
        );
        await pending;
      });
      assertLocation("/about", 5);
      assert.equal(push.mock.callCount(), 1, "reselection never adds duplicate history entries");

      const responses: ((response: Response) => void)[] = [];
      fetchMock.mock.mockImplementation(
        () => new Promise<Response>((done) => responses.push(done)),
      );
      let canvasPending!: Promise<void> | void;
      let externalPending!: Promise<void> | void;
      await React.act(async () => {
        canvasPending = navigate!({ to: "/same#section", source: "canvas" });
        externalPending = navigate!({ to: "/same#section" });
      });
      const response = () =>
        new Response(
          JSON.stringify({ ...input, pathname: "/same", dehydratedState: dehydrate(seed) }),
        );
      await React.act(async () => {
        responses[1]!(response());
        await externalPending;
      });
      assert.equal(renderedInput.pathname, "/same");
      assert.equal(committedSource, undefined, "latest request owns committed provenance");
      await React.act(async () => {
        responses[0]!(response());
        await canvasPending;
      });
      assert.equal(
        committedSource,
        undefined,
        "stale canvas request cannot suppress an external flight",
      );
    } finally {
      await React.act(async () => root.unmount());
      queryClient.clear();
      seed.clear();
      await window.happyDOM.close();
    }
  });
}
