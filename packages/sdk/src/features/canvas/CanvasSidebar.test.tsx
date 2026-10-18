import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

import { QueryClient } from "@tanstack/react-query";
import { Window, type HTMLButtonElement } from "happy-dom";
import * as React from "react";

import type { Block } from "../../core/createBlock";
import { StudioQueryClientProvider, testStudioCache } from "../../lib/draft-scope.fixtures";
import { reads } from "../../lib/studio-reads";
import { NavigationProvider } from "../navigation/navigation";
import { getCanvasShelves } from "./canvasItems";
import type { CanvasPage } from "./canvasPages";

type CanvasNavigator = React.ComponentProps<
  typeof import("./CanvasSidebar").CanvasSidebar
>["navigator"];

const navigationUrl = new URL("../navigation/navigation.tsx", import.meta.url).href;
const ownerUrl = new URL("../preview/previewSelection.ts", import.meta.url).href;
const probeImports = `
  import {useLocation, useNavigate} from ${JSON.stringify(navigationUrl)};
  import {PreviewEditingOwnerContext} from ${JSON.stringify(ownerUrl)};
`;

// Keep navigation, queries, cache seeding, and preview ownership real.
// Replace leaf UI only, so RPC/rendering assertions don't require the entire studio.
registerHooks({
  resolve(specifier, context, nextResolve) {
    let source: string | undefined;
    if (specifier === "@camox/ui/toaster")
      source = "export const toast = Object.assign(() => {}, { error: () => {} })";
    if (context.parentURL?.endsWith("/CanvasSidebar.tsx")) {
      if (specifier.endsWith("/auth"))
        source = 'export const useProjectSlug = () => "test-project"';
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
      if (specifier.endsWith("/PageSidebar"))
        source = `${probeImports}
          export function PageSidebar({pageId, derivedLayout}) {
            const location = useLocation();
            const navigate = useNavigate();
            const owner = React.useContext(PreviewEditingOwnerContext);
            return React.createElement("button", {
              "data-sidebar": "PageSidebar",
              "data-id": pageId ?? derivedLayout?.layoutId,
              "data-path": location.pathname,
              "data-owner": JSON.stringify(owner),
              onClick: () => navigate({to: "/articles/hello%20world"}),
            }, pageId ?? derivedLayout?.layoutId);
          }`;
    }
    if (source)
      return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const home: CanvasPage = { key: "page:7", pageId: "7", title: "Home", pathname: "/" };
const singleton: CanvasPage = {
  key: "layout:about",
  layoutId: "about",
  title: "About",
  pathname: "/about",
};
const derivedPage: CanvasPage = {
  key: "derived:articles.$slug",
  layoutId: "articles.$slug",
  derivedLayoutId: "articles.$slug",
  title: "Article",
  pathname: null,
};

function pageStructure(path: string) {
  return {
    page: { id: "7", fullPath: path, metaTitle: path, blockIds: ["42"] },
    layout: null,
  };
}

async function setup() {
  const dom = new Window({ url: "http://localhost/" });
  const calls: unknown[] = [];
  const api = {
    pages: {
      getStructure: async (input: { path: string; projectSlug: string }) => {
        calls.push(input);
        return pageStructure(input.path);
      },
    },
    blocks: {
      getPagesUsing: async ({ type }: { type: string }) =>
        (globalThis as unknown as { canvasBlockPages: Record<string, unknown[]> }).canvasBlockPages[
          type
        ] ?? [],
    },
    layouts: {
      get: async (input: { layoutId: string; projectSlug: string }) => {
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
    // The Canvas navigator's Command list measures itself.
    ResizeObserver: dom.ResizeObserver,
    requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
    cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
    canvasBlockPages: {
      hero: [
        { id: "7", nickname: "Home", fullPath: "/" },
        { id: "83", nickname: "Special article", fullPath: "/articles/special" },
      ],
    } as Record<string, { id: string; nickname: string; fullPath: string }[]>,
  };
  const previous = new Map(
    Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  Object.assign(globalThis, globals);
  const { createRoot } = await import("react-dom/client");
  const { CanvasSidebar } = await import("./CanvasSidebar");
  const { PreviewEditingOwnerContext } = await import("../preview/previewSelection");
  const { previewStore: store } = await import("../preview/previewStore");
  const mount = dom.document.createElement("div");
  dom.document.body.append(mount);
  const root = createRoot(mount as unknown as HTMLElement, { onCaughtError() {} });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  const navigations: { to: string; replace?: boolean }[] = [];
  let canvasShown = 0;
  const renames: [pageId: string, nickname: string][] = [];
  return {
    api,
    calls,
    renames,
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
      catalog?: { block: Block; projectId: number },
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
                <CanvasSidebar
                  page={page}
                  catalog={catalog}
                  navigator={{ shelves: [], onShowItem: () => {}, ...navigator }}
                  onShowWholeCanvas={() => canvasShown++}
                  onRenamePage={async (pageId, nickname) => {
                    renames.push([pageId, nickname]);
                  }}
                />
                <main>Canvas stays visible</main>
              </PreviewEditingOwnerContext>
            </NavigationProvider>
          </StudioQueryClientProvider>,
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
    const sidebar = dom.mount.querySelector<HTMLButtonElement>("[data-sidebar]")!;
    assert.equal(sidebar.getAttribute("data-path"), "/");
    assert.equal(sidebar.getAttribute("data-owner"), "null");
    assert.equal(sidebar.getAttribute("data-id"), "7");
    assert.equal(dom.mount.querySelectorAll("aside").length, 1);
    assert.deepEqual(dom.calls, [{ path: "/", projectSlug: "test-project" }]);
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
  return testStudioCache(client).get(reads.pageStructure({ path, projectSlug: "test-project" }));
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
      const sidebar = dom.mount.querySelector("[data-sidebar]")!;
      assert.equal(sidebar.getAttribute("data-id"), page.layoutId);
      assert.equal(sidebar.getAttribute("data-path"), path);
      assert.equal(sidebar.getAttribute("data-owner"), "null");
      assert.equal(dom.mount.querySelector("[data-add-block]"), null);
      assert.ok(dom.mount.querySelector("[data-create-page]"));
    }
    assert.deepEqual(dom.calls, [
      { layoutId: "about", projectSlug: "test-project" },
      { layoutId: "articles.$slug", projectSlug: "test-project" },
    ]);
    assert.deepEqual(testStudioCache(dom.client).get(reads.blockBundle("42")), {
      block: { id: "42", content: { text: "layout" } },
      files: [],
      repeatableItems: [],
    });
    await dom.render("/missing", undefined);
    assert.ok(
      dom.mount.querySelector("[data-canvas-navigator-sidebar]"),
      "without a Page, the Canvas navigator shows",
    );
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
    await dom.render("/", home);
    assert.ok(dom.mount.querySelector('[role="status"]'));
    assert.equal(dom.mount.querySelector("main")?.textContent, "Canvas stays visible");
    await React.act(async () => reject(new Error("Offline")));
    await dom.settle();
    assert.ok(dom.mount.querySelector('[role="alert"]'));
    assert.equal(dom.mount.querySelector("main")?.textContent, "Canvas stays visible");
    await dom.render("/about", singleton);
    await dom.settle();
    assert.equal(dom.mount.querySelector('[role="alert"]'), null);
    assert.equal(dom.mount.querySelector("[data-sidebar]")?.getAttribute("data-id"), "about");
  } finally {
    await dom.close();
  }
});

void test("the Canvas navigator lists every item under its shelf, searches, and shows the picked one", async () => {
  const dom = await setup();
  const block = (id: string, title: string) =>
    ({ _internal: { id, title, description: "", layoutOnly: false } }) as Block;
  const shelves = getCanvasShelves(
    [home, singleton],
    [block("tabs", "Tabs"), block("faq", "FAQ"), block("hero", "Hero")],
  );
  const shown: string[] = [];
  const entries = () =>
    [...dom.mount.querySelectorAll("[cmdk-item]")].map((entry) => ({
      text: entry.textContent,
      current: entry.getAttribute("aria-current"),
      group: entry.closest("[cmdk-group]")?.querySelector("[cmdk-group-heading]")?.textContent,
    }));
  try {
    await dom.render("/camox/blocks/hero", undefined, {
      shelves,
      selectedKey: "block:hero",
      onShowItem: (key) => shown.push(key),
    });
    assert.equal(dom.mount.querySelector("[data-sidebar]"), null, "no Page sidebar on a block");
    const blocksToggle = () =>
      dom.mount.querySelector("[cmdk-group] button[aria-expanded]") as unknown as HTMLElement;
    assert.deepEqual(
      entries(),
      [
        { text: "Home/", current: null, group: "Pages (2)" },
        { text: "About/about", current: null, group: "Pages (2)" },
      ],
      "Pages show with their path; blocks start collapsed",
    );
    assert.equal(blocksToggle().getAttribute("aria-expanded"), "false");
    assert.equal(blocksToggle().textContent, "3 blocks");
    assert.deepEqual(
      [...dom.mount.querySelectorAll("[cmdk-group-heading]")].map((heading) => heading.textContent),
      ["Pages (2)"],
      "the blocks toggle names them, without a shelf heading",
    );

    const search = dom.mount.querySelector("[cmdk-input]") as unknown as HTMLInputElement;
    assert.equal(document.activeElement, search, "the search takes focus");
    const type = (value: string) =>
      React.act(async () => {
        // Set the value past React's own tracking, as typing does.
        Reflect.set(Object.getPrototypeOf(search), "value", value, search);
        search.dispatchEvent(new window.Event("input", { bubbles: true }));
      });
    await type("about");
    assert.deepEqual(
      entries().map(({ text }) => text),
      ["About/about"],
      "searching matches labels",
    );
    await type("/abo");
    assert.deepEqual(
      entries().map(({ text }) => text),
      ["About/about"],
      "and Page paths",
    );
    await type("hero");
    assert.deepEqual(
      entries(),
      [{ text: "Hero", current: "true", group: "Blocks (3)" }],
      "searching finds collapsed blocks too, under their shelf's heading",
    );
    await type("block");
    assert.deepEqual(entries(), [], "but never item keys");
    await type("");
    assert.equal(blocksToggle().getAttribute("aria-expanded"), "false", "blocks collapse again");

    await React.act(async () => blocksToggle().click());
    assert.deepEqual(
      entries(),
      [
        { text: "Home/", current: null, group: "Pages (2)" },
        { text: "About/about", current: null, group: "Pages (2)" },
        { text: "FAQ", current: null, group: undefined },
        { text: "Hero", current: "true", group: undefined },
        { text: "Tabs", current: null, group: undefined },
      ],
      "expanded, every item, in Canvas order, with the selected one marked; blocks under their toggle alone",
    );

    const tabs = [...dom.mount.querySelectorAll("[cmdk-item]")].find(
      (entry) => entry.textContent === "Tabs",
    ) as unknown as HTMLElement;
    await React.act(async () => tabs.click());
    assert.deepEqual(shown, ["block:tabs"], "picking an item shows it");

    await dom.render("/", home);
    await dom.settle();
    assert.equal(
      dom.mount.querySelector("[data-canvas-navigator-sidebar]"),
      null,
      "a Page restores its sidebar",
    );
    assert.equal(dom.mount.querySelector("[data-sidebar]")?.getAttribute("data-id"), "7");
  } finally {
    await dom.close();
  }
});

void test("a selected item's sidebar names it under a back button that shows the whole Canvas", async () => {
  const dom = await setup();
  try {
    for (const [url, page] of [
      ["/", home],
      ["/about", singleton],
    ] as const) {
      await dom.render(url, page);
      await dom.settle();
      const aside = dom.mount.querySelector("aside")!;
      const heading = aside.querySelector("h2")!;
      const nickname = heading.querySelector("input");
      assert.equal(nickname?.value ?? heading.textContent, page.title);
      assert.equal(!!nickname, page.pageId != null, "only a Page's nickname can be edited");
      assert.equal(aside.getAttribute("aria-label"), page.title);
      assert.equal(dom.mount.querySelector("[data-canvas-navigator-sidebar]"), null);
    }
    const back = dom.mount.querySelector<HTMLButtonElement>('[aria-label="Show whole canvas"]')!;
    await React.act(async () => back.click());
    assert.equal(dom.canvasShown, 1);
    assert.deepEqual(dom.navigations, [], "the Canvas, not the sidebar, leaves the selection");
  } finally {
    await dom.close();
  }
});

void test("a Page's nickname is renamed from the sidebar's header", async () => {
  const dom = await setup();
  try {
    await dom.render("/", home);
    await dom.settle();
    const input = dom.mount.querySelector(
      'aside h2 input[aria-label="Page nickname"]',
    ) as unknown as HTMLInputElement;
    const type = async (value: string, key: string) => {
      await React.act(async () => {
        input.focus();
        input.value = value;
        input.dispatchEvent(new window.KeyboardEvent("keydown", { key, bubbles: true }));
      });
      await dom.settle();
    };

    await type("  Landing  ", "Enter");
    assert.deepEqual(dom.renames, [["7", "Landing"]], "Enter saves the trimmed nickname");

    await type("Draft", "Escape");
    assert.equal(input.value, "Home", "Escape puts the nickname back");
    await type("", "Enter");
    assert.equal(input.value, "Home", "an empty nickname is refused");
    await type("Home", "Enter");
    assert.deepEqual(dom.renames, [["7", "Landing"]], "nothing else saves");
  } finally {
    await dom.close();
  }
});

void test("a selected block shows its description and the Pages using it, which select the Page", async () => {
  const dom = await setup();
  const block = (id: string, description = `${id} description`) =>
    ({ _internal: { id, title: id, description, layoutOnly: false } }) as Block;
  const showBlock = async (id: string, description?: string, url = `/camox/blocks/${id}`) => {
    await dom.render(url, undefined, {}, { block: block(id, description), projectId: 1 });
    await dom.settle();
  };
  try {
    await showBlock("hero", undefined, "/camox/blocks/hero?zoom=2#top");
    assert.equal(dom.mount.querySelector("aside h2")?.textContent, "hero");
    assert.match(dom.mount.textContent, /hero description/);
    assert.equal(dom.mount.querySelector("[data-sidebar]"), null, "no Page sidebar");
    assert.equal(dom.mount.querySelector("[data-canvas-navigator-sidebar]"), null);
    const pages = [...dom.mount.querySelectorAll<HTMLButtonElement>("aside li button")];
    assert.deepEqual(
      pages.map((page) => page.textContent),
      ["Home/", "Special article/articles/special"],
    );
    await React.act(async () => pages[1]!.click());
    assert.deepEqual(
      dom.navigations,
      [{ to: "/articles/special?zoom=2#top" }],
      "a sidebar selection keeps the search and hash like a Canvas selection, but isn't canvas-sourced, so the camera flies to the Page",
    );
    await React.act(async () =>
      dom.mount.querySelector<HTMLButtonElement>('[aria-label="Show whole canvas"]')!.click(),
    );
    assert.equal(dom.canvasShown, 1, "a block leads back to the Canvas too");

    await showBlock("tabs");
    assert.match(dom.mount.textContent, /tabs description/);
    assert.equal(dom.mount.querySelector("aside li"), null);
    assert.match(dom.mount.textContent, /No pages use this block/);

    await showBlock("faq", "");
    assert.equal(
      [...dom.mount.querySelectorAll("aside p")].filter((p) => p.textContent === "").length,
      0,
      "an empty description leaves no empty paragraph",
    );
  } finally {
    await dom.close();
  }
});
