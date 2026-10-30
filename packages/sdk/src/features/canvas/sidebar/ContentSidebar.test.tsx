import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

import { QueryClient } from "@tanstack/react-query";
import { Window, type HTMLButtonElement } from "happy-dom";
import * as React from "react";

import { StudioQueryClientProvider, testStudioCache } from "../../../lib/draft-scope.fixtures";
import { reads } from "../../../lib/studio-reads";
import { NavigationProvider } from "../../navigation/navigation";
import type { EditingOwner } from "../../preview/previewStore";
import type { CanvasPage } from "../canvasPages";

type ContentSidebarProps = React.ComponentProps<typeof import("./ContentSidebar").ContentSidebar>;
type CanvasNavigator = ContentSidebarProps["navigator"];

const navigationUrl = new URL("../../navigation/navigation.tsx", import.meta.url).href;
const ownerUrl = new URL("../../preview/previewSelection.ts", import.meta.url).href;
const probeImports = `
  import {useLocation, useNavigate} from ${JSON.stringify(navigationUrl)};
  import {PreviewEditingOwnerContext} from ${JSON.stringify(ownerUrl)};
`;

/** A leaf panel standing in for the real one: what it shows, where, and for which owner. */
const panel = (name: string, id: string) => `${probeImports}
  export function ${name}(props) {
    const location = useLocation();
    const navigate = useNavigate();
    const owner = React.useContext(PreviewEditingOwnerContext);
    return React.createElement("button", {
      "data-panel": "${name}",
      "data-id": ${id},
      "data-path": location.pathname,
      "data-owner": JSON.stringify(owner),
      onClick: () => navigate({to: "/articles/hello%20world"}),
    }, "${name}");
  }`;

// Keep navigation, queries, cache seeding, the choice of inspector, and preview ownership and
// selection real. Replace leaf UI only, so RPC/rendering assertions don't require the entire studio.
registerHooks({
  resolve(specifier, context, nextResolve) {
    let source: string | undefined;
    if (specifier === "@camox/ui/toaster")
      source = "export const toast = Object.assign(() => {}, { error: () => {} })";
    if (context.parentURL?.includes("/canvas/sidebar/")) {
      if (specifier.endsWith("/auth"))
        source = 'export const useProjectUuid = () => "test-project"';
      if (specifier.endsWith("/CreatePageModal"))
        source = `${probeImports}
          export function CreatePageModal() {
            const navigate = useNavigate();
            return React.createElement("button", {
              "data-create-page": true,
              onClick: () => navigate({to: "/created", replace: true}),
            }, "Create page");
          }`;
      if (specifier.endsWith("/AddBlockSheet"))
        source = `${probeImports}
          export function AddBlockSheet({focusCreatedBlock}) {
            return React.createElement("div", {
              "data-add-block": useLocation().pathname,
              "data-focus-created-block": String(focusCreatedBlock),
            });
          }`;
      if (specifier.endsWith("/PageTree")) source = panel("PageTree", "null");
      if (specifier.endsWith("/PageInfo")) source = panel("PageInfo", "props.pageId");
      if (specifier === "./LayoutPageBlocks")
        source = panel("LayoutPageBlocks", "props.layout.layoutId");
      if (specifier === "./LayoutPageSeo")
        source = panel("LayoutPageSeo", 'props.target.derivedLayoutId ?? "singleton"');
      if (specifier.endsWith("/SelectionEditor")) source = panel("SelectionEditor", "null");
    }
    if (source)
      return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const home: CanvasPage = {
  kind: "curated",
  key: "page:7",
  pageId: "7",
  title: "Home",
  pathname: "/",
};
const singleton: CanvasPage = {
  kind: "singleton",
  key: "singleton:about",
  layoutId: "about",
  title: "About",
  pathname: "/about",
};
const derivedPage: CanvasPage = {
  kind: "derived",
  key: "derived:articles.$slug",
  layoutId: "articles.$slug",
  pattern: "/articles/:slug",
  title: "Article",
  pathname: null,
};

function pageStructure(path: string) {
  return {
    page: { id: "7", fullPath: path, metaTitle: path, blockIds: ["42"] },
    layout: null,
  };
}

async function setup({ motion = false } = {}) {
  // Views that go linger as copies while they move away, which most tests don't watch.
  const dom = new Window({
    url: "http://localhost/",
    settings: { device: { prefersReducedMotion: motion ? "no-preference" : "reduce" } },
  });
  const calls: unknown[] = [];
  const api = {
    pages: {
      getStructure: async (input: { path: string; projectUuid: string }) => {
        calls.push(input);
        return pageStructure(input.path);
      },
    },
    layouts: {
      get: async (input: { layoutId: string; projectUuid: string }) => {
        calls.push(input);
        return {
          layout: { id: "12", layoutId: input.layoutId, beforeBlockIds: ["42"], afterBlockIds: [] },
          blocks: [{ id: "42", content: { text: "layout" } }],
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
    ResizeObserver: dom.ResizeObserver,
    requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
    cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = new Map(
    Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  Object.assign(globalThis, globals);
  const { createRoot } = await import("react-dom/client");
  const { ContentSidebar } = await import("./ContentSidebar");
  const { PreviewEditingOwnerContext } = await import("../../preview/previewSelection");
  const { previewStore: store } = await import("../../preview/previewStore");
  const mount = dom.document.createElement("div");
  dom.document.body.append(mount);
  const root = createRoot(mount as unknown as HTMLElement, { onCaughtError() {} });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  const navigations: { to: string; replace?: boolean }[] = [];
  let canvasShown = 0;
  return {
    api,
    calls,
    client,
    mount,
    navigations,
    store,
    get canvasShown() {
      return canvasShown;
    },
    async render(
      url: string,
      page: CanvasPage | undefined,
      navigator: Partial<CanvasNavigator> = {},
      { owner }: Pick<ContentSidebarProps, "owner"> = {},
    ) {
      const { pathname, search, hash } = new URL(url, "https://camox.test");
      await React.act(async () => {
        root.render(
          <StudioQueryClientProvider client={client} api={() => api as never}>
            <NavigationProvider
              location={{ pathname, href: url, search, hash }}
              navigate={(options) => {
                navigations.push(options);
              }}
            >
              <PreviewEditingOwnerContext value={{ kind: "page", pageId: "7" }}>
                <ContentSidebar
                  page={page}
                  navigator={{ pages: [], onShowPage: () => {}, ...navigator }}
                  onShowWholeCanvas={() => canvasShown++}
                  owner={owner}
                  runtimeBasePath=""
                />
                <main>Canvas stays visible</main>
              </PreviewEditingOwnerContext>
            </NavigationProvider>
          </StudioQueryClientProvider>,
        );
      });
    },
    /** The leaf panels shown, by name and the id each shows. */
    panels() {
      return [...mount.querySelectorAll("[data-panel]")].map((panel) => [
        panel.getAttribute("data-panel"),
        panel.getAttribute("data-id"),
      ]);
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
      store.send({ type: "hideCanvas" });
      await dom.happyDOM.close();
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    },
  };
}

void test("curated sidebar shares the selected path cache and forwards sidebar/dialog site navigation", async () => {
  const dom = await setup();
  dom.store.send({ type: "showCanvas" });
  dom.store.send({ type: "setFocusedBlock", kind: "page", pageId: "7", blockId: "42" });
  const snapshot = dom.store.getSnapshot();
  try {
    await dom.render("/", home);
    await dom.settle();
    const sidebar = dom.mount.querySelector<HTMLButtonElement>('[data-panel="PageInfo"]')!;
    assert.equal(sidebar.getAttribute("data-path"), "/");
    assert.equal(sidebar.getAttribute("data-owner"), "null");
    assert.equal(sidebar.getAttribute("data-id"), "7");
    assert.deepEqual(
      dom.panels(),
      [
        ["PageTree", null],
        ["PageInfo", "7"],
      ],
      "a curated page shows its blocks, then what's about it",
    );
    assert.equal(dom.mount.querySelectorAll("aside").length, 1);
    assert.deepEqual(dom.calls, [{ path: "/", projectUuid: "test-project" }]);
    assert.deepEqual(clientPage(dom.client, "/"), pageStructure("/"));
    assert.equal(dom.mount.querySelector("[data-add-block]")?.getAttribute("data-add-block"), "/");
    assert.equal(
      dom.mount.querySelector("[data-add-block]")?.getAttribute("data-focus-created-block"),
      "false",
    );
    await React.act(async () => sidebar.click());
    await React.act(async () =>
      dom.mount.querySelector<HTMLButtonElement>("[data-create-page]")!.click(),
    );
    assert.deepEqual(dom.navigations, [
      { to: "/articles/hello%20world" },
      { to: "/created", replace: true },
    ]);
    assert.equal(sidebar.getAttribute("data-path"), "/", "selection waits for the outer URL");
    await dom.render("/other", {
      ...home,
      key: "page:8",
      pathname: "/other",
      pageId: "8",
    });
    await dom.settle();
    assert.equal(
      dom.mount.querySelector('[data-panel="PageInfo"]')?.getAttribute("data-path"),
      "/other",
    );
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
  return testStudioCache(client).get(reads.pageStructure({ path, projectUuid: "test-project" }));
}

void test("singleton and derived layout sidebars load shared layouts, seed their blocks, and use full URL pages", async () => {
  const dom = await setup();
  dom.store.send({ type: "showCanvas" });
  try {
    for (const [path, page] of [
      ["/about", singleton],
      ["/articles/hello%20world", derivedPage],
      ["/articles/another", derivedPage],
    ] as const) {
      await dom.render(path, page);
      await dom.settle();
      assert.deepEqual(
        dom.panels(),
        [
          ["LayoutPageBlocks", page.layoutId],
          ["LayoutPageSeo", page.kind === "derived" ? page.layoutId : "singleton"],
        ],
        "a layout page shows its layout's blocks, then its SEO and Markdown",
      );
      const sidebar = dom.mount.querySelector('[data-panel="LayoutPageBlocks"]')!;
      assert.equal(sidebar.getAttribute("data-id"), page.layoutId);
      assert.equal(sidebar.getAttribute("data-path"), path);
      assert.equal(sidebar.getAttribute("data-owner"), "null");
      assert.equal(dom.mount.querySelector("[data-add-block]"), null);
      assert.ok(dom.mount.querySelector("[data-create-page]"));
    }
    assert.deepEqual(dom.calls, [
      { layoutId: "about", projectUuid: "test-project" },
      { layoutId: "articles.$slug", projectUuid: "test-project" },
    ]);
    assert.deepEqual(testStudioCache(dom.client).get(reads.blockBundle("42")), {
      block: { id: "42", content: { text: "layout" } },
      files: [],
      repeatableItems: [],
    });
    await dom.render("/missing", undefined);
    assert.ok(
      dom.mount.querySelector("[data-canvas-navigator]"),
      "without a Page, the Canvas navigator shows",
    );
  } finally {
    await dom.close();
  }
});

void test("loading and failed sidebar requests leave the canvas visible; another URL recovers", async () => {
  const dom = await setup();
  let reject!: (reason: Error) => void;
  const failure = () =>
    [...dom.mount.querySelectorAll('[role="alert"]')]
      .map((alert) => alert.textContent)
      .find((text) => /could not be loaded/.test(text));
  dom.api.pages.getStructure = () =>
    new Promise((_resolve, rejectRequest) => {
      reject = rejectRequest;
    });
  try {
    await dom.render("/", home);
    assert.ok(dom.mount.querySelector('[role="status"]'));
    assert.equal(dom.mount.querySelector("main")?.textContent, "Canvas stays visible");
    await React.act(async () => reject(new Error("Offline")));
    await dom.settle();
    assert.match(failure() ?? "", /could not be loaded/);
    assert.equal(dom.mount.querySelector("main")?.textContent, "Canvas stays visible");
    await dom.render("/about", singleton);
    await dom.settle();
    assert.equal(failure(), undefined);
    assert.equal(
      dom.mount.querySelector('[data-panel="LayoutPageBlocks"]')?.getAttribute("data-id"),
      "about",
    );
  } finally {
    await dom.close();
  }
});

void test("the active frame owner's selection opens the selection editor in place of every kind of Page's overview", async () => {
  const dom = await setup();
  dom.store.send({ type: "showCanvas" });
  const editing = () => dom.panels().some(([name]) => name === "SelectionEditor");
  try {
    for (const [url, page, owner] of [
      ["/", home, { kind: "page", pageId: "7" }],
      ["/about", singleton, { kind: "layout", layoutId: "about" }],
      ["/articles/hello", derivedPage, { kind: "layout", layoutId: "articles.$slug" }],
    ] as const) {
      dom.store.send({ type: "setFocusedBlock", ...owner, blockId: "42" });
      await dom.render(url, page, {}, { owner });
      await dom.settle();
      assert.deepEqual(dom.panels(), [["SelectionEditor", null]], `a ${page.kind} page edits it`);
      assert.equal(
        dom.mount.querySelector("[data-panel]")?.getAttribute("data-owner"),
        JSON.stringify(owner),
        "for the Page's owner",
      );

      await dom.render(url, page, {}, { owner: { kind: "page", pageId: "83" } });
      assert.equal(editing(), false, "another frame's selection isn't this Page's");

      dom.store.send({ type: "clearSelection" });
      await dom.render(url, page, {}, { owner });
      assert.equal(editing(), false, "without a selection, the overview shows again");
    }
  } finally {
    await dom.close();
  }
});

void test("a view that goes stays out of reach while it moves away, then leaves no trace", async () => {
  const dom = await setup({ motion: true });
  dom.store.send({ type: "showCanvas" });
  const owner: EditingOwner = { kind: "page", pageId: "7" };
  try {
    await dom.render("/", home, {}, { owner });
    await dom.settle();

    dom.store.send({ type: "setFocusedBlock", ...owner, blockId: "42" });
    await dom.render("/", home, {}, { owner });
    const going = dom.mount.querySelectorAll('[data-panel="PageTree"]');
    assert.equal(going.length, 1, "the page's view moves behind the selection's");
    assert.ok(going[0].closest('[inert][aria-hidden="true"]'), "where nothing reaches it");
    assert.ok(dom.mount.querySelector('[data-panel="SelectionEditor"]'), "under the selection's");

    await React.act(() => new Promise((resolve) => setTimeout(resolve, 800)));
    assert.equal(dom.mount.querySelector('[data-panel="PageTree"]'), null, "then it's gone");
  } finally {
    await dom.close();
  }
});

void test("a record page's selected record opens the editor, and clearing it shows the overview", async () => {
  const dom = await setup();
  dom.store.send({ type: "showCanvas" });
  const owner: EditingOwner = { kind: "layout", layoutId: "articles.$slug" };
  const render = () => dom.render("/articles/hello", derivedPage, {}, { owner });
  try {
    // No block places a record page's record.
    dom.store.send({
      type: "selectTarget",
      ...owner,
      selection: { type: "record", layoutId: "articles.$slug", recordId: "article" },
    });
    await render();
    await dom.settle();
    assert.deepEqual(dom.panels(), [["SelectionEditor", null]]);

    dom.store.send({ type: "clearSelection" });
    await render();
    assert.deepEqual(dom.panels(), [
      ["LayoutPageBlocks", "articles.$slug"],
      ["LayoutPageSeo", "articles.$slug"],
    ]);
  } finally {
    await dom.close();
  }
});

void test("the Canvas navigator lists every Page and shows the picked one", async () => {
  const dom = await setup();
  const shown: string[] = [];
  const entries = () =>
    [...dom.mount.querySelectorAll<HTMLButtonElement>("[data-canvas-navigator] li button")].map(
      (entry) => ({ text: entry.textContent, current: entry.getAttribute("aria-current") }),
    );
  try {
    await dom.render("/camox/canvas", undefined, {
      pages: [home, singleton],
      selectedKey: singleton.key,
      onShowPage: (key) => shown.push(key),
    });
    assert.equal(dom.mount.querySelector("[data-panel]"), null, "no Page inspector");
    assert.deepEqual(
      entries(),
      [
        { text: "Home/", current: null },
        { text: "About/about", current: "page" },
      ],
      "every Page, in Canvas order, with its path, and the selected one marked",
    );
    assert.equal(
      dom.mount.querySelector("[data-canvas-navigator] input"),
      null,
      "no search to take focus",
    );

    const about = [
      ...dom.mount.querySelectorAll<HTMLButtonElement>("[data-canvas-navigator] li button"),
    ].find((entry) => entry.textContent === "About/about")!;
    await React.act(async () => about.click());
    assert.deepEqual(shown, [singleton.key], "picking a Page shows it");

    await dom.render("/", home);
    await dom.settle();
    assert.equal(
      dom.mount.querySelector("[data-canvas-navigator]"),
      null,
      "a Page restores its sidebar",
    );
    assert.equal(dom.mount.querySelector('[data-panel="PageInfo"]')?.getAttribute("data-id"), "7");
  } finally {
    await dom.close();
  }
});

void test("a selected Page's sidebar names it over the Canvas's header, which shows the whole Canvas", async () => {
  const dom = await setup();
  try {
    for (const [url, page] of [
      ["/", home],
      ["/about", singleton],
    ] as const) {
      await dom.render(url, page);
      await dom.settle();
      const aside = dom.mount.querySelector("aside")!;
      assert.equal(aside.querySelector("h2")?.textContent, page.title);
      assert.equal(aside.getAttribute("aria-label"), page.title);
      assert.equal(dom.mount.querySelector("[data-canvas-navigator]"), null);
    }
    const back = [...dom.mount.querySelectorAll<HTMLButtonElement>("aside button")].find(
      (button) => button.textContent === "Site",
    )!;
    await React.act(async () => back.click());
    assert.equal(dom.canvasShown, 1);
    assert.deepEqual(dom.navigations, [], "the Canvas, not the sidebar, leaves the selection");
  } finally {
    await dom.close();
  }
});
