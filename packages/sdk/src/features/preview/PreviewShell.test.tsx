import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

import { QueryClient } from "@tanstack/react-query";
import * as React from "react";

import { StudioQueryClientProvider, testStudioCache } from "../../lib/draft-scope.fixtures";
import { reads } from "../../lib/studio-reads";

Object.assign(globalThis, { React });

let canvasImports = 0;
const preparationUrl = new URL("./previewPreparation.ts", import.meta.url).href;

// Keep the shell, mode store, actions and shared-chrome context real. Leaf
// markers expose which surface owns the preview without loading Canvas itself.
registerHooks({
  resolve(specifier, context, nextResolve) {
    let source: string | undefined;
    if (specifier === "@camox/ui/toaster")
      source = `export const toast = Object.assign(() => {}, {
        promise: (promise) => { void promise.catch(() => {}); },
        dismiss: () => {},
      })`;
    if (context.parentURL?.endsWith("/CamoxPreview.tsx")) {
      const stubs: Record<string, string> = {
        "@/features/navigation/navigation":
          "export const useLocation = () => ({pathname: '/'}); export const useNavigate = () => (options) => { globalThis.testNavigations?.push(options) }",
        "@/hooks/use-page-destinations": "export const usePageDestinations = () => []",
        "@/lib/auth":
          "export const useIsAuthenticated = () => true; export const useProjectSlug = () => 'test'",
        "@/lib/normalized-data":
          "export const NormalizedDataProvider = ({children}) => children; export const usePageBlocks = () => ({})",
        "@/lib/queries": "export const blockQueries = {}",
        "@/lib/utils": "export const cn = (...args) => args.filter(Boolean).join(' ')",
        "../provider/components/CamoxAppContext": "export const useCamoxApp = () => ({})",
        "../page/DerivedPageContent":
          "export const DerivedPageContent = () => React.createElement('p', {'data-derived-content': true})",
        "./components/PreviewPanel":
          "export const PreviewPanel = ({children, layoutId}) => React.createElement('section', {'data-preview': true, 'data-layout-id': layoutId}, children)",
        // The record page's data and slug following load nothing in the shell.
        "./pageRecord": `
          export const PageRecordContext = React.createContext(undefined);
          export const useDerivedPageResult = ({loaded}) => loaded?.result;
          export const useFollowPageRecord = () => {};
          export const getPageRecord = () => undefined;
        `,
      };
      source = stubs[specifier] ?? source;
      for (const name of ["AddBlockDialog", "BlockErrorBoundary", "CreatePageModal"]) {
        if (specifier === `./components/${name}`) source = `export const ${name} = () => null`;
      }
      if (specifier.includes("feature-flag")) {
        throw new Error("PreviewShell must choose Canvas by mode, not a feature flag");
      }
    }
    if (
      context.parentURL?.endsWith("/CanvasPreview.tsx") &&
      specifier === "../../canvas/CamoxCanvas"
    ) {
      canvasImports += 1;
      source = `
        import { PreviewPreparationContext } from ${JSON.stringify(preparationUrl)};
        export const CamoxCanvas = ({runtimeBasePath}) => {
          const preparation = React.useContext(PreviewPreparationContext);
          React.useLayoutEffect(() => preparation.ready(), [preparation]);
          return React.createElement('section', {'data-canvas': true, 'data-runtime-base-path': runtimeBasePath});
        }`;
    }
    if (source)
      return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

async function setup() {
  const { Window } = await import("happy-dom");
  const window = new Window();
  Object.assign(globalThis, {
    window,
    document: window.document,
    HTMLElement: window.HTMLElement,
    Element: window.Element,
    Node: window.Node,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const { createRoot } = await import("react-dom/client");
  const host = window.document.createElement("div");
  window.document.body.append(host);
  const root = createRoot(host as unknown as HTMLElement);
  return {
    host,
    async render(children: React.ReactNode) {
      await React.act(async () => root.render(children));
    },
    async close() {
      await React.act(async () => root.unmount());
      await window.happyDOM.close();
    },
  };
}

void test("PreviewShell lazily adds Canvas by mode and keeps the single preview's content, including derived layouts", async (t) => {
  const dom = await setup();
  const { PreviewShell } = await import("./CamoxPreview");
  const { previewStore: store } = await import("./previewStore");
  const { actionsStore } = await import("../provider/actionsStore");
  type ShellProps = React.ComponentProps<typeof PreviewShell>;
  const pageData = {
    page: { id: "3" },
    projectName: "Test",
  } as ShellProps["pageData"];
  const derivedLayout = {
    layoutId: "article",
    contentUpdatedAt: 0,
    updatedAt: 0,
    beforeBlockIds: [],
    afterBlockIds: [],
  } satisfies ShellProps["derivedLayout"];
  const count = (selector: string) => dom.host.querySelectorAll(selector).length;
  const assertPreview = () => {
    assert.equal(count("[data-preview]"), 1);
    assert.equal(count("[data-content]"), 1);
    assert.equal(count("[data-canvas]"), 0);
  };
  const assertCanvas = () => {
    assert.equal(count("[data-canvas]"), 1);
    // The Canvas borrows the preview's frame for the selected Page, so it stays mounted.
    assert.equal(count("[data-preview]"), 1);
    assert.equal(count("[data-content]"), 1);
    assert.equal(
      dom.host.querySelector("[data-canvas]")?.getAttribute("data-runtime-base-path"),
      "/nested/studio",
    );
    const cycle = actionsStore
      .getSnapshot()
      .context.actions.find((action) => action.id === "cycle-viewport-mode");
    assert.equal(cycle?.shortcut?.key, "m", "viewport commands survive both Canvas modes");
  };
  const reset = () => {
    store.send({ type: "hideCanvas" });
  };
  try {
    reset();
    await t.test("plain preview does not even import Canvas", async () => {
      await dom.render(
        <PreviewShell pageData={pageData}>
          <p data-content>Site content</p>
        </PreviewShell>,
      );
      assertPreview();
      assert.equal(canvasImports, 0);
    });

    for (const [name, props] of [
      ["curated page", { pageData }],
      ["derived layout", { derivedLayout }],
    ] as const) {
      await t.test(`${name}: Canvas and single-preview mode transitions`, async () => {
        await dom.render(null);
        reset();
        await dom.render(
          <PreviewShell {...props} runtimeBasePath="/nested/studio">
            <p data-content>Site content</p>
          </PreviewShell>,
        );
        assertPreview();
        // Toggling the Canvas never remounts the page, in either direction.
        const content = dom.host.querySelector("[data-content]");
        const assertSameContent = () =>
          assert.equal(dom.host.querySelector("[data-content]"), content);
        if (name === "derived layout") {
          assert.equal(
            dom.host.querySelector("[data-preview]")?.getAttribute("data-layout-id"),
            "article",
          );
        }
        await React.act(async () => store.send({ type: "showCanvas" }));
        assertCanvas();
        assertSameContent();
        assert.ok(canvasImports > 0);

        await React.act(async () => store.send({ type: "hideCanvas" }));
        assert.equal(count("[data-preview]"), 1);
        assert.equal(count("[data-content]"), 1);
        const kept = dom.host.querySelector("[data-canvas]");
        assert.ok(kept, "the ready Canvas is kept, so showing it again needs no loading");
        assert.equal(
          (kept.closest("[data-canvas-preparation]") as HTMLElement | null)?.style.display,
          "none",
          "the kept Canvas is hidden",
        );
        assertSameContent();
        const imports = canvasImports;

        await React.act(async () => store.send({ type: "showCanvas" }));
        assert.equal(dom.host.querySelector("[data-canvas]"), kept, "the kept Canvas shows again");
        assert.equal(canvasImports, imports);
        assertSameContent();
      });
    }

    await t.test(
      "showing the Canvas before a single frame commits releases the SSR fallback",
      async () => {
        const { PreviewActivation } = await import("./components/PreviewActivation");
        await dom.render(null);
        reset();
        await dom.render(
          <PreviewActivation fallback={<p data-server-fallback>Server page</p>}>
            <PreviewShell pageData={pageData} runtimeBasePath="/nested/studio">
              <p data-content>Site content</p>
            </PreviewShell>
          </PreviewActivation>,
        );
        assert.equal(count("[data-server-fallback]"), 1);
        await React.act(async () => store.send({ type: "showCanvas" }));
        assertCanvas();
        assert.equal(count("[data-server-fallback]"), 0);
      },
    );
  } finally {
    await dom.close();
    reset();
  }
});

void test("leaving the preview resets preview and canvas state", async () => {
  const dom = await setup();
  const { PreviewShell } = await import("./CamoxPreview");
  const { previewStore } = await import("./previewStore");
  const { canvasStore } = await import("../canvas/canvasStore");
  const pageData = {
    page: { id: "3" },
    projectName: "Test",
  } as React.ComponentProps<typeof PreviewShell>["pageData"];
  const initialPreview = previewStore.getSnapshot().context;
  try {
    await dom.render(
      <PreviewShell pageData={pageData}>
        <p data-content>Site content</p>
      </PreviewShell>,
    );
    await React.act(async () => {
      previewStore.send({ type: "showCanvas" });
      previewStore.send({ type: "setViewportMode", mode: "mobile" });
      previewStore.send({ type: "setFocusedBlock", kind: "page", pageId: "3", blockId: "9" });
      canvasStore.send({
        type: "rememberView",
        workspaceKey: "workspace",
        view: { camera: { x: 1, y: 2, scale: 0.5 }, fitted: false },
      });
    });
    assert.equal(previewStore.getSnapshot().context.view, "canvas");

    await dom.render(null);
    assert.deepEqual(previewStore.getSnapshot().context, initialPreview);
    assert.deepEqual(canvasStore.getSnapshot().context.views, {});
  } finally {
    await dom.close();
  }
});

void test("curated and derived navigation retain the same Canvas workspace", async () => {
  const dom = await setup();
  const { CamoxPreview } = await import("./CamoxPreview");
  const { previewStore } = await import("./previewStore");
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const layout = {
    id: 7,
    layoutId: "article",
    contentUpdatedAt: 0,
    updatedAt: 0,
    beforeBlockIds: [],
    afterBlockIds: [],
  };
  // What the server filled in for each page it rendered.
  const cache = testStudioCache(client);
  cache.set(reads.pageStructure({ path: "/", projectSlug: "test" }), { page: { id: 3 } });
  cache.set(reads.derivedLayout({ projectSlug: "test", layoutId: "article" }), layout);
  type Props = React.ComponentProps<typeof CamoxPreview>;
  const render = (derived?: Props["derived"], canvasOnly?: Props["canvasOnly"]) =>
    dom.render(
      <StudioQueryClientProvider client={client}>
        <CamoxPreview derived={derived} canvasOnly={canvasOnly}>
          <p data-content>Site content</p>
        </CamoxPreview>
      </StudioQueryClientProvider>,
    );
  try {
    previewStore.send({ type: "showCanvas" });
    await render();
    const canvas = dom.host.querySelector("[data-canvas]");
    assert.ok(canvas);
    // The page frame is placed relative to the room beside the Canvas sidebar, so
    // that room must not change as the selection does, or the frame jumps.
    const sidebarRoom = () => dom.host.querySelector("[data-canvas-sidebar-skeleton]");
    const room = sidebarRoom();
    assert.ok(room);
    await render({ layoutId: "article", layout });
    assert.equal(dom.host.querySelector("[data-canvas]"), canvas);
    await render();
    assert.equal(dom.host.querySelector("[data-canvas]"), canvas);
    await render(undefined, { blockId: "hero" });
    assert.equal(dom.host.querySelector("[data-canvas]"), canvas, "selecting a block keeps it");
    assert.equal(sidebarRoom(), room, "selecting a block keeps the sidebar's room");
    await render(undefined, {});
    assert.equal(dom.host.querySelector("[data-canvas]"), canvas, "selecting nothing keeps it");
    assert.equal(sidebarRoom(), room, "selecting nothing keeps the sidebar's room");
    await render();
    assert.equal(dom.host.querySelector("[data-canvas]"), canvas);
  } finally {
    await dom.close();
    client.clear();
    previewStore.send({ type: "hideCanvas" });
  }
});

void test("a Canvas-only location keeps the last page mounted in the Preview", async () => {
  const dom = await setup();
  const { CamoxPreview } = await import("./CamoxPreview");
  const { previewStore } = await import("./previewStore");
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  testStudioCache(client).set(reads.pageStructure({ path: "/", projectSlug: "test" }), {
    page: { id: 3 },
  });
  type Props = React.ComponentProps<typeof CamoxPreview>;
  const render = (canvasOnly?: Props["canvasOnly"]) =>
    dom.render(
      <StudioQueryClientProvider client={client}>
        <CamoxPreview canvasOnly={canvasOnly}>
          <p data-content>Site content</p>
        </CamoxPreview>
      </StudioQueryClientProvider>,
    );
  try {
    previewStore.send({ type: "showCanvas" });
    await render();
    const content = dom.host.querySelector("[data-content]");
    assert.ok(content);
    await render({});
    assert.equal(
      dom.host.querySelector("[data-content]"),
      content,
      "selecting nothing keeps the page",
    );
    await render({ blockId: "hero" });
    assert.equal(dom.host.querySelector("[data-content]"), content, "so does selecting a block");
    await render();
    assert.equal(dom.host.querySelector("[data-content]"), content);
  } finally {
    await dom.close();
    client.clear();
    previewStore.send({ type: "hideCanvas" });
  }
});

void test("a Block Catalog block opens on the Canvas, and goes home without it", async (t) => {
  const dom = await setup();
  const { PreviewShell } = await import("./CamoxPreview");
  const { previewStore } = await import("./previewStore");
  const navigations: { to: string; replace?: boolean }[] = [];
  Object.assign(globalThis, { testNavigations: navigations });
  const shell = (
    <PreviewShell canvasOnly={{ blockId: "hero" }} runtimeBasePath="/nested/studio">
      {null}
    </PreviewShell>
  );
  const home = [{ to: "/", replace: true }];
  try {
    await t.test("a block link shows the Canvas", async () => {
      await dom.render(shell);
      assert.equal(previewStore.getSnapshot().context.view, "canvas");
      assert.ok(dom.host.querySelector("[data-canvas]"));
      assert.deepEqual(navigations, []);
    });

    await t.test("hiding the Canvas on a block goes home", async () => {
      await React.act(async () => previewStore.send({ type: "hideCanvas" }));
      assert.deepEqual(navigations.splice(0), home);
    });

    await t.test("mobile Studio goes home", async () => {
      await dom.render(null);
      const matchMedia = window.matchMedia;
      Object.assign(window, {
        matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
      });
      try {
        await dom.render(shell);
        assert.deepEqual(navigations.splice(0), home);
        assert.equal(dom.host.querySelector("[data-canvas]"), null);
      } finally {
        Object.assign(window, { matchMedia });
      }
    });
  } finally {
    await dom.close();
    previewStore.send({ type: "hideCanvas" });
    Reflect.deleteProperty(globalThis, "testNavigations");
  }
});
