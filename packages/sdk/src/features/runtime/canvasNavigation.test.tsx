import assert from "node:assert/strict";
import { test } from "node:test";

import { QueryClient, dehydrate } from "@tanstack/react-query";
import { Window } from "happy-dom";
import * as React from "react";

import { useLocation, useNavigate } from "../navigation/navigation";
import { isCanvasPath } from "../studio/routes";
import { PageNavigationProvider } from "./pageNavigation";
import type { PageRenderInput } from "./runtime";

void test("canvas path matching respects segment boundaries", () => {
  for (const path of ["/camox/canvas", "/camox/canvas/", "/camox/canvas/blog/post"])
    assert.equal(isCanvasPath(path), true);
  for (const path of ["/camox/canvases", "/camox/content", "/canvas"])
    assert.equal(isCanvasPath(path), false);
});

for (const base of ["", "/mounted"]) {
  void test(`canvas navigation is URL-only (base: ${base || "/"})`, async (t) => {
    const window = new Window({ url: `https://site.test${base}/camox/canvas` });
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
    const fetchMock = t.mock.method(globalThis, "fetch", async () => {
      throw new Error("Canvas navigation must not fetch");
    });
    const scrollMock = t.mock.method(window, "scrollTo", () => {});
    document.head.innerHTML = "<title data-camox-page-head>Canvas</title>";
    document.body.innerHTML = '<div id="root"></div>';
    const head = document.head.innerHTML;
    const queryClient = new QueryClient();
    const seed = new QueryClient();
    seed.setQueryData(["must-not-hydrate"], "payload");
    const input: PageRenderInput = {
      presentation: "studio",
      apiUrl: "https://api.test",
      authenticationUrl: "https://auth.test",
      projectSlug: "test",
      environmentName: "production",
      source: "draft",
      href: window.location.href,
      pathname: "/camox/canvas",
      runtimeBasePath: base,
      routeKind: "studio-nested",
      head: { title: "Must not replace head" },
      layoutIdentity: null,
      loaderData: null,
      dehydratedState: dehydrate(seed),
    };
    let navigate: ReturnType<typeof useNavigate>;
    let mounts = 0;
    let unmounts = 0;
    function Workspace() {
      navigate = useNavigate();
      const location = useLocation();
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
    const assertLocation = (path: string) => {
      assert.equal(document.querySelector("output")!.textContent, path);
      assert.equal(window.location.href, `https://site.test${base}${path}`);
      assert.equal(document.head.innerHTML, head);
      assert.equal(fetchMock.mock.callCount(), 0);
      assert.equal(scrollMock.mock.callCount(), 0);
      assert.equal(queryClient.getQueryData(["must-not-hydrate"]), undefined);
      assert.equal(mounts, 1);
      assert.equal(unmounts, 0);
    };
    try {
      await React.act(async () => {
        root.render(
          <PageNavigationProvider initialInput={input} queryClient={queryClient}>
            {() => <Workspace />}
          </PageNavigationProvider>,
        );
      });
      const push = t.mock.method(window.history, "pushState");
      const replace = t.mock.method(window.history, "replaceState");
      await React.act(async () => {
        await navigate!({ to: "/camox/canvas/blog/post?view=wide#section" });
      });
      assertLocation("/camox/canvas/blog/post?view=wide#section");
      assert.equal(push.mock.callCount(), 1);
      await React.act(async () => {
        await navigate!({ to: "/camox/canvas/about", replace: true });
      });
      assertLocation("/camox/canvas/about");
      assert.equal(replace.mock.callCount(), 1);
      // Happy DOM does not implement history traversal: reproduce the browser's
      // URL update followed by popstate for back and forward.
      for (const path of ["/camox/canvas", "/camox/canvas/about"]) {
        window.history.replaceState(null, "", `${base}${path}`);
        const replacements = replace.mock.callCount();
        await React.act(async () => {
          window.dispatchEvent(new window.PopStateEvent("popstate"));
        });
        assertLocation(path);
        assert.equal(push.mock.callCount(), 1);
        assert.equal(replace.mock.callCount(), replacements);
      }
    } finally {
      await React.act(async () => root.unmount());
      queryClient.clear();
      seed.clear();
      await window.happyDOM.close();
    }
  });
}
