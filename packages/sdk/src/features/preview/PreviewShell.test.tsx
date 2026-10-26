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

const navigationStub =
  "export const useLocation = () => ({pathname: globalThis.testPathname ?? '/', href: 'http://localhost' + (globalThis.testPathname ?? '/'), search: '', hash: ''}); export const useNavigate = () => (options) => { globalThis.testNavigations?.push(options) }";

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
        "@/features/navigation/navigation": navigationStub,
        "@/hooks/use-page-destinations": "export const usePageDestinations = () => []",
        "@/lib/auth":
          "export const useIsAuthenticated = () => true; export const useProjectUuid = () => 'test'",
        "@/lib/queries": "export const blockQueries = {}",
        "@/lib/utils": "export const cn = (...args) => args.filter(Boolean).join(' ')",
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
      // Like the real one, it reads the page at the current location, and
      // waits forever on a Canvas-only one, which has none.
      if (specifier === "./components/AddBlockSheet")
        source = `export const AddBlockSheet = () => {
          if (globalThis.testPathname === "/camox/canvas") throw new Promise(() => {});
          return null;
        }`;
      for (const name of ["CreatePageModal"]) {
        if (specifier === `./components/${name}`) source = `export const ${name} = () => null`;
      }
      if (specifier.includes("feature-flag")) {
        throw new Error("PreviewShell must choose Canvas by mode, not a feature flag");
      }
    }
    // The Preview's slot reads where it renders, as the shell does.
    if (
      context.parentURL?.endsWith("/RendererFrames.tsx") &&
      specifier === "../navigation/navigation"
    )
      source = navigationStub;
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
  // The signed-in Studio always has a studio cache, which the Canvas prefetch reads with.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    host,
    async render(children: React.ReactNode) {
      await React.act(async () =>
        root.render(
          <StudioQueryClientProvider client={client}>{children}</StudioQueryClientProvider>,
        ),
      );
    },
    /** Waits until pending timers, like an idle prefetch, have run. */
    async settle() {
      await React.act(async () => window.happyDOM.waitUntilComplete());
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
    assert.equal(cycle?.shortcut, "M", "viewport commands survive both Canvas modes");
  };
  const reset = () => {
    store.send({ type: "hideCanvas" });
  };
  try {
    reset();
    await t.test("plain preview does not import Canvas while rendering", async () => {
      await dom.render(
        <PreviewShell pageData={pageData}>
          <p data-content>Site content</p>
        </PreviewShell>,
      );
      assertPreview();
      assert.equal(canvasImports, 0);
    });

    await t.test("an idle Studio prefetches the Canvas before it shows", async () => {
      await dom.settle();
      assertPreview();
      assert.equal(canvasImports, 1);
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

void test("leaving the preview keeps preview and canvas state for coming back", async () => {
  const dom = await setup();
  const { PreviewShell } = await import("./CamoxPreview");
  const { previewStore } = await import("./previewStore");
  const { canvasStore } = await import("../canvas/canvasStore");
  const pageData = {
    page: { id: "3" },
    projectName: "Test",
  } as React.ComponentProps<typeof PreviewShell>["pageData"];
  const view = { camera: { x: 1, y: 2, scale: 0.5 }, fitted: false };
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
      canvasStore.send({ type: "rememberView", workspaceKey: "workspace", view });
    });
    const shown = previewStore.getSnapshot().context;

    await dom.render(null);
    assert.equal(previewStore.getSnapshot().context, shown);
    assert.deepEqual(canvasStore.getSnapshot().context.views.workspace, view);
  } finally {
    await dom.close();
    previewStore.send({ type: "reset" });
    canvasStore.send({ type: "reset" });
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
  cache.set(reads.pageStructure({ path: "/", projectUuid: "test" }), { page: { id: 3 } });
  cache.set(reads.layoutStructure({ projectUuid: "test", layoutId: "article" }), layout);
  type Props = React.ComponentProps<typeof CamoxPreview>;
  const render = (derived?: Props["derived"], canvasOnly?: Props["canvasOnly"]) =>
    dom.render(
      <StudioQueryClientProvider client={client}>
        <CamoxPreview derived={derived} canvasOnly={canvasOnly} />
      </StudioQueryClientProvider>,
    );
  try {
    previewStore.send({ type: "showCanvas" });
    await render();
    const canvas = dom.host.querySelector("[data-canvas]");
    assert.ok(canvas);
    await render({ layoutId: "article", layout });
    assert.equal(dom.host.querySelector("[data-canvas]"), canvas);
    await render();
    assert.equal(dom.host.querySelector("[data-canvas]"), canvas);
    await render(undefined, true);
    assert.equal(dom.host.querySelector("[data-canvas]"), canvas, "selecting nothing keeps it");
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
  testStudioCache(client).set(reads.pageStructure({ path: "/", projectUuid: "test" }), {
    page: { id: 3 },
  });
  type Props = React.ComponentProps<typeof CamoxPreview>;
  const render = (canvasOnly?: Props["canvasOnly"]) =>
    dom.render(
      <StudioQueryClientProvider client={client}>
        <CamoxPreview canvasOnly={canvasOnly} />
      </StudioQueryClientProvider>,
    );
  try {
    previewStore.send({ type: "showCanvas" });
    await render();
    // The renderer frame renders the page into the Preview's slot.
    const slot = dom.host.querySelector("[data-camox-renderer-slot]");
    assert.ok(slot);
    await render(true);
    assert.equal(
      dom.host.querySelector("[data-camox-renderer-slot]"),
      slot,
      "selecting nothing keeps the page",
    );
    await render();
    assert.equal(dom.host.querySelector("[data-camox-renderer-slot]"), slot);
  } finally {
    await dom.close();
    client.clear();
    previewStore.send({ type: "hideCanvas" });
  }
});

for (const outcome of ["rendered", "error"] as const) {
  void test(`a spinner in the Canvas's background covers the Preview until the renderer frame shows its page (${outcome})`, async () => {
    const dom = await setup();
    const { CamoxPreview } = await import("./CamoxPreview");
    const { fakeRenderer, settle } = await import("../renderer/protocol.fixtures");
    const { STUDIO_HANDLE_KEY } = await import("../renderer/protocol");
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    testStudioCache(client).set(reads.pageStructure({ path: "/", projectUuid: "test" }), {
      page: { id: 3 },
    });
    const loading = () => dom.host.querySelector('[role="status"][aria-label="Loading the page"]');
    try {
      await dom.render(
        <StudioQueryClientProvider client={client}>
          <CamoxPreview />
        </StudioQueryClientProvider>,
      );
      assert.ok(loading(), "before any renderer connects");
      assert.ok(loading()!.closest("[data-canvas-loading]")!.className.includes("bg-muted"));

      const frame = dom.host.querySelector("iframe[data-camox-renderer]") as unknown as Record<
        typeof STUDIO_HANDLE_KEY,
        Parameters<typeof fakeRenderer>[0]
      >;
      const renderer = fakeRenderer(frame[STUDIO_HANDLE_KEY]);
      await React.act(settle);
      assert.ok(loading(), "the renderer connected, but hasn't shown the page yet");

      const frameId = renderer.last("frame")!.frameId;
      await React.act(async () => {
        renderer.send(
          outcome === "rendered"
            ? { type: "rendered", frameId }
            : { type: "error", frameId, message: "The page failed" },
        );
        await settle();
      });
      assert.equal(loading(), null, "the page, or why it failed, shows");
    } finally {
      await dom.close();
      client.clear();
    }
  });
}

void test("a renderer of another SDK version shows that the preview updates, not a spinner", async () => {
  const dom = await setup();
  const { CamoxPreview } = await import("./CamoxPreview");
  const { fakeRenderer, settle } = await import("../renderer/protocol.fixtures");
  const { SDK_VERSION, STUDIO_HANDLE_KEY } = await import("../renderer/protocol");
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  testStudioCache(client).set(reads.pageStructure({ path: "/", projectUuid: "test" }), {
    page: { id: 3 },
  });
  try {
    await dom.render(
      <StudioQueryClientProvider client={client}>
        <CamoxPreview />
      </StudioQueryClientProvider>,
    );
    const frame = dom.host.querySelector("iframe[data-camox-renderer]") as unknown as Record<
      typeof STUDIO_HANDLE_KEY,
      Parameters<typeof fakeRenderer>[0]
    >;
    fakeRenderer(frame[STUDIO_HANDLE_KEY], { sdkVersion: `${SDK_VERSION}-other` });
    await React.act(settle);
    assert.equal(dom.host.querySelector('[aria-label="Loading the page"]'), null);
    assert.ok(dom.host.querySelector("[data-camox-renderer-updating]"));
  } finally {
    await dom.close();
    client.clear();
  }
});

void test("hiding the Canvas after selecting nothing goes back to the last page", async () => {
  const dom = await setup();
  const { CamoxPreview } = await import("./CamoxPreview");
  const { previewStore } = await import("./previewStore");
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  testStudioCache(client).set(reads.pageStructure({ path: "/about", projectUuid: "test" }), {
    page: { id: 3 },
  });
  const navigations: { to: string; replace?: boolean }[] = [];
  Object.assign(globalThis, { testNavigations: navigations, testPathname: "/about" });
  type Props = React.ComponentProps<typeof CamoxPreview>;
  const render = (canvasOnly?: Props["canvasOnly"]) =>
    dom.render(
      <StudioQueryClientProvider client={client}>
        <CamoxPreview canvasOnly={canvasOnly} />
      </StudioQueryClientProvider>,
    );
  try {
    previewStore.send({ type: "showCanvas" });
    await render();
    // Deselecting on the Canvas moves to its Canvas-only location, keeping the last page.
    Object.assign(globalThis, { testPathname: "/camox/canvas" });
    await render(true);
    await React.act(async () => previewStore.send({ type: "hideCanvas" }));
    assert.deepEqual(navigations, [{ to: "/about", replace: true }]);
  } finally {
    await dom.close();
    client.clear();
    previewStore.send({ type: "hideCanvas" });
    Reflect.deleteProperty(globalThis, "testNavigations");
    Reflect.deleteProperty(globalThis, "testPathname");
  }
});

void test("the Canvas opened first with nothing selected shows the Canvas, and goes home without it", async (t) => {
  const dom = await setup();
  const { PreviewShell } = await import("./CamoxPreview");
  const { previewStore } = await import("./previewStore");
  const navigations: { to: string; replace?: boolean }[] = [];
  Object.assign(globalThis, { testNavigations: navigations });
  const shell = (
    <PreviewShell canvasOnly runtimeBasePath="/nested/studio">
      {null}
    </PreviewShell>
  );
  const home = [{ to: "/", replace: true }];
  try {
    await t.test("a Canvas link shows the Canvas", async () => {
      await dom.render(shell);
      assert.equal(previewStore.getSnapshot().context.view, "canvas");
      assert.ok(dom.host.querySelector("[data-canvas]"));
      assert.deepEqual(navigations, []);
    });

    await t.test("hiding the Canvas with nothing selected goes home", async () => {
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
