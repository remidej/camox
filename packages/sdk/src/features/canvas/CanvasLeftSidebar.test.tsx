import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

import { queryKeys } from "@camox/api-contract/query-keys";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Window, type HTMLButtonElement } from "happy-dom";
import * as React from "react";

import { NavigationProvider } from "../navigation/navigation";
import type { CanvasPage } from "./canvasPages";

const navigationUrl = new URL("../navigation/navigation.tsx", import.meta.url).href;
const ownerUrl = new URL("../preview/previewSelection.ts", import.meta.url).href;
const probeImports = `
  import {useLocation, useNavigate} from ${JSON.stringify(navigationUrl)};
  import {PreviewEditingOwnerContext} from ${JSON.stringify(ownerUrl)};
`;

// Keep LeftSidebar, navigation, queries, cache seeding, and preview ownership real.
// Replace leaf UI only, so RPC/rendering assertions don't require the entire studio.
registerHooks({
  resolve(specifier, context, nextResolve) {
    let source: string | undefined;
    if (specifier === "@camox/ui/toaster") source = "export const toast = () => {}";
    if (context.parentURL?.endsWith("/CanvasLeftSidebar.tsx")) {
      if (specifier.endsWith("/auth"))
        source = 'export const useProjectSlug = () => "test-project"';
      if (specifier.endsWith("/api-client"))
        source = "export const getApiClient = () => globalThis.canvasSidebarApi";
      if (specifier.endsWith("/CreatePageModal"))
        source = `${probeImports}
          export function CreatePageModal() {
            const navigate = useNavigate();
            return React.createElement("button", {
              "data-create-page": true,
              onClick: () => navigate({to: "/created", replace: true}),
            }, "Create page");
          }`;
      if (specifier.endsWith("/AddBlockDialog"))
        source = `${probeImports}
          export function AddBlockDialog({focusCreatedBlock}) {
            return React.createElement("div", {
              "data-add-block": useLocation().pathname,
              "data-focus-created-block": String(focusCreatedBlock),
            });
          }`;
    }
    if (context.parentURL?.endsWith("/LeftSidebar.tsx")) {
      const name =
        specifier === "./PageNavigatorSidebar"
          ? "PageNavigatorSidebar"
          : specifier === "./DerivedLayoutSidebar"
            ? "DerivedLayoutSidebar"
            : undefined;
      if (name)
        source = `${probeImports}
          export function ${name}({page, layout}) {
            const location = useLocation();
            const navigate = useNavigate();
            const owner = React.useContext(PreviewEditingOwnerContext);
            return React.createElement("button", {
              "data-sidebar": "${name}",
              "data-id": page?.id ?? layout?.layoutId,
              "data-path": location.pathname,
              "data-owner": JSON.stringify(owner),
              onClick: () => navigate({to: "/articles/hello%20world"}),
            }, page?.metaTitle ?? layout?.layoutId);
          }`;
    }
    if (source)
      return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const home: CanvasPage = { key: "page:7", pageId: 7, title: "Home", pathname: "/" };
const singleton: CanvasPage = {
  key: "layout:about",
  layoutId: "about",
  title: "About",
  pathname: "/about",
};
const template: CanvasPage = {
  key: "template:articles.$slug",
  layoutId: "articles.$slug",
  templateId: "articles.$slug",
  title: "Article",
  pathname: null,
};

function pageStructure(path: string) {
  return {
    page: { id: 7, fullPath: path, metaTitle: path, blockIds: [42] },
    layout: null,
  };
}

async function setup() {
  const dom = new Window({ url: "http://localhost/camox/canvas" });
  const calls: unknown[] = [];
  const api = {
    pages: {
      getStructure: async (input: { path: string; source: string; projectSlug: string }) => {
        calls.push(input);
        return pageStructure(input.path);
      },
    },
    layouts: {
      get: async (input: { layoutId: string; source: string; projectSlug: string }) => {
        calls.push(input);
        return {
          layout: { id: 12, layoutId: input.layoutId, beforeBlockIds: [42], afterBlockIds: [] },
          blocks: [{ id: 42, content: { text: input.source } }],
          files: [],
          repeatableItems: [],
        };
      },
    },
  };
  const globals = {
    React,
    window: dom,
    document: dom.document,
    Element: dom.Element,
    HTMLElement: dom.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
    canvasSidebarApi: api,
  };
  const previous = new Map(
    Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  Object.assign(globalThis, globals);
  const { createRoot } = await import("react-dom/client");
  const { CanvasLeftSidebar } = await import("./CanvasLeftSidebar");
  const { PreviewEditingOwnerContext } = await import("../preview/previewSelection");
  const { previewStore: store } = await import("../preview/previewStore");
  const mount = dom.document.createElement("div");
  dom.document.body.append(mount);
  const root = createRoot(mount as unknown as HTMLElement, { onCaughtError() {} });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  const navigations: { to: string; replace?: boolean }[] = [];
  return {
    api,
    calls,
    client,
    mount,
    navigations,
    store,
    async render(pathname: string, page: CanvasPage | undefined) {
      await React.act(async () => {
        root.render(
          <QueryClientProvider client={client}>
            <NavigationProvider
              location={{ pathname, href: pathname, search: "", hash: "" }}
              navigate={(options) => {
                navigations.push(options);
              }}
            >
              <PreviewEditingOwnerContext value={{ kind: "page", pageId: 7 }}>
                <CanvasLeftSidebar page={page} />
                <main>Canvas stays visible</main>
              </PreviewEditingOwnerContext>
            </NavigationProvider>
          </QueryClientProvider>,
        );
      });
    },
    async settle() {
      await React.act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    },
    async close() {
      await React.act(async () => root.unmount());
      client.clear();
      store.send({ type: "activatePage", pageId: null });
      store.send({ type: "exitEditMode" });
      await dom.happyDOM.close();
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    },
  };
}

void test("curated sidebar shares the selected path cache and maps picker/dialog navigation back to canvas", async () => {
  const dom = await setup();
  dom.store.send({ type: "enterEditMode" });
  dom.store.send({ type: "setFocusedBlock", kind: "page", pageId: 7, blockId: 42 });
  const snapshot = dom.store.getSnapshot();
  try {
    await dom.render("/camox/canvas", home);
    await dom.settle();
    const picker = dom.mount.querySelector<HTMLButtonElement>("[data-sidebar]")!;
    assert.equal(picker.getAttribute("data-path"), "/");
    assert.equal(picker.getAttribute("data-owner"), "null");
    assert.equal(picker.getAttribute("data-id"), "7");
    assert.equal(dom.mount.querySelectorAll("aside").length, 1, "uses actual LeftSidebar");
    assert.deepEqual(dom.calls, [{ path: "/", projectSlug: "test-project", source: "draft" }]);
    assert.deepEqual(clientPage(dom.client, "/"), pageStructure("/"));
    assert.equal(dom.mount.querySelector("[data-add-block]")?.getAttribute("data-add-block"), "/");
    assert.equal(
      dom.mount.querySelector("[data-add-block]")?.getAttribute("data-focus-created-block"),
      "false",
    );
    await React.act(async () => picker.click());
    await React.act(async () =>
      dom.mount.querySelector<HTMLButtonElement>("[data-create-page]")!.click(),
    );
    assert.deepEqual(dom.navigations, [
      { to: "/camox/canvas/articles/hello%20world", replace: undefined },
      { to: "/camox/canvas/created", replace: true },
    ]);
    assert.equal(picker.getAttribute("data-path"), "/", "selection waits for the outer URL");
    await dom.render("/camox/canvas/other", {
      ...home,
      key: "page:8",
      pathname: "/other",
      pageId: 8,
    });
    await dom.settle();
    assert.equal(dom.mount.querySelector("[data-sidebar]")?.getAttribute("data-path"), "/other");
    assert.deepEqual(clientPage(dom.client, "/other"), pageStructure("/other"));
    assert.equal(
      dom.store.getSnapshot(),
      snapshot,
      "mount/navigation never change preview selection",
    );
  } finally {
    await dom.close();
  }
});

function clientPage(client: QueryClient, path: string) {
  return client.getQueryData(queryKeys.pages.getByPath(path, "draft"));
}

void test("singleton and template sidebars load shared layouts, seed source-specific blocks, and use full URL instances", async () => {
  const dom = await setup();
  dom.store.send({ type: "enterEditMode" });
  try {
    for (const [path, page] of [
      ["/about", singleton],
      ["/articles/hello%20world", template],
      ["/articles/another", template],
    ] as const) {
      await dom.render(`/camox/canvas${path}`, page);
      await dom.settle();
      const sidebar = dom.mount.querySelector("[data-sidebar]")!;
      assert.equal(sidebar.getAttribute("data-sidebar"), "DerivedLayoutSidebar");
      assert.equal(sidebar.getAttribute("data-id"), page.layoutId);
      assert.equal(sidebar.getAttribute("data-path"), path);
      assert.equal(sidebar.getAttribute("data-owner"), "null");
      assert.equal(dom.mount.querySelector("[data-add-block]"), null);
      assert.ok(dom.mount.querySelector("[data-create-page]"));
    }
    assert.deepEqual(dom.calls, [
      { layoutId: "about", projectSlug: "test-project", source: "draft" },
      { layoutId: "articles.$slug", projectSlug: "test-project", source: "draft" },
    ]);
    assert.deepEqual(dom.client.getQueryData(queryKeys.blocks.get(42, "draft")), {
      block: { id: 42, content: { text: "draft" } },
      files: [],
      repeatableItems: [],
    });
    await React.act(async () => dom.store.send({ type: "viewLivePage" }));
    await dom.settle();
    assert.deepEqual(dom.calls.at(-1), {
      layoutId: "articles.$slug",
      projectSlug: "test-project",
      source: "live",
    });
    assert.ok(dom.client.getQueryData(queryKeys.blocks.get(42, "live")));
    await dom.render("/camox/canvas/missing", undefined);
    assert.equal(dom.mount.querySelector("aside"), null);
  } finally {
    await dom.close();
  }
});

void test("loading and failed sidebar requests leave the canvas visible; another URL recovers", async () => {
  const dom = await setup();
  let reject!: (reason: Error) => void;
  dom.api.pages.getStructure = () =>
    new Promise((_resolve, rejectRequest) => {
      reject = rejectRequest;
    });
  try {
    await dom.render("/camox/canvas", home);
    assert.ok(dom.mount.querySelector('[role="status"]'));
    assert.equal(dom.mount.querySelector("main")?.textContent, "Canvas stays visible");
    await React.act(async () => reject(new Error("Offline")));
    await dom.settle();
    assert.ok(dom.mount.querySelector('[role="alert"]'));
    assert.equal(dom.mount.querySelector("main")?.textContent, "Canvas stays visible");
    await dom.render("/camox/canvas/about", singleton);
    await dom.settle();
    assert.equal(dom.mount.querySelector('[role="alert"]'), null);
    assert.equal(dom.mount.querySelector("[data-sidebar]")?.getAttribute("data-id"), "about");
  } finally {
    await dom.close();
  }
});
