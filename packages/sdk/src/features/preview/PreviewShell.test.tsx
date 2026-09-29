import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

import { queryKeys } from "@camox/api-contract/query-keys";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";

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
          "export const useLocation = () => ({pathname: '/'}); export const useNavigate = () => () => {}",
        "@/hooks/use-page-destinations": "export const usePageDestinations = () => []",
        "@/lib/api-client": `export const getApiClient = () => ({
          pages: { getByPath: () => Promise.reject(new Error("No refetch in shell test")) },
          layouts: { get: () => Promise.resolve({layout: globalThis.testPreviewLayout, blocks: [], files: [], repeatableItems: []}) },
        })`,
        "@/lib/auth":
          "export const useIsAuthenticated = () => true; export const useProjectSlug = () => 'test'",
        "@/lib/normalized-data":
          "export const NormalizedDataProvider = ({children}) => children; export const seedBlockCaches = () => {}; export const usePageBlocks = () => ({})",
        "@/lib/queries": "export const blockQueries = {}",
        "@/lib/utils": "export const cn = (...args) => args.filter(Boolean).join(' ')",
        "../provider/components/CamoxAppContext": "export const useCamoxApp = () => ({})",
        "../page/DerivedPageContent":
          "export const DerivedPageContent = () => React.createElement('p', {'data-derived-content': true})",
        "../studio/components/Navbar":
          "export const Navbar = () => React.createElement('nav', {'data-navbar': true})",
        "./components/PreviewPanel":
          "export const PreviewPanel = ({children, layoutId}) => React.createElement('section', {'data-preview': true, 'data-layout-id': layoutId}, children)",
        "./components/PreviewToolbar":
          "export const PreviewToolbar = () => React.createElement('div', {'data-toolbar': true})",
      };
      source = stubs[specifier] ?? source;
      for (const name of [
        "AddBlockDialog",
        "BlockErrorBoundary",
        "CreatePageModal",
        "LeftSidebar",
      ]) {
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

void test("PreviewShell lazily swaps the single preview for Canvas by mode, including derived layouts", async (t) => {
  const dom = await setup();
  const { PreviewShell } = await import("./CamoxPreview");
  const { previewStore: store } = await import("./previewStore");
  const { actionsStore } = await import("../provider/actionsStore");
  const { SharedChromeContext } = await import("../runtime/SharedChromeContext");
  type ShellProps = React.ComponentProps<typeof PreviewShell>;
  const pageData = {
    page: { id: 3, status: "draft", livePublishedCheckpointId: 1 },
    projectName: "Test",
  } as ShellProps["pageData"];
  const derivedLayout = {
    id: 7,
    layoutId: "article",
    contentUpdatedAt: 0,
    updatedAt: 0,
    livePublishedCheckpointId: 1,
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
    assert.equal(count("[data-preview]"), 0);
    assert.equal(count("[data-content]"), 0);
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
    store.send({ type: "exitEditMode" });
    store.send({ type: "viewDraftSite" });
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
      ["derived layout", { derivedLayoutId: "article", derivedLayout, hasLiveVersion: true }],
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
        if (name === "derived layout") {
          assert.equal(
            dom.host.querySelector("[data-preview]")?.getAttribute("data-layout-id"),
            "7",
          );
        }
        await React.act(async () => store.send({ type: "enterEditMode" }));
        assertCanvas();
        assert.equal(count("[data-toolbar]"), 1);
        assert.ok(canvasImports > 0);

        await React.act(async () => store.send({ type: "exitEditMode" }));
        assertPreview();
        await React.act(async () => {
          store.send({ type: "enterEditMode" });
          store.send({ type: "setCommentMode", enabled: true });
        });
        assert.equal(store.getSnapshot().context.mode, "commenting-draft");
        assertCanvas();
        await React.act(async () => store.send({ type: "viewLiveSite" }));
        assertPreview();
        await React.act(async () => store.send({ type: "viewDraftSite" }));
        assertPreview();
        assert.ok(canvasImports > 0);
      });
    }

    await t.test("shared chrome has no duplicate navbar or toolbar", async () => {
      for (const commenting of [false, true]) {
        await React.act(async () => {
          store.send({ type: "enterEditMode" });
          store.send({ type: "setCommentMode", enabled: commenting });
        });
        await dom.render(
          <SharedChromeContext value={true}>
            <nav data-navbar />
            <div data-toolbar />
            <PreviewShell pageData={pageData} runtimeBasePath="/nested/studio">
              <p data-content>Site content</p>
            </PreviewShell>
          </SharedChromeContext>,
        );
        assertCanvas();
        assert.equal(count("[data-navbar]"), 1);
        assert.equal(count("[data-toolbar]"), 1);
      }
    });

    await t.test(
      "entering edit mode before a single frame commits releases the SSR fallback",
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
        await React.act(async () => store.send({ type: "enterEditMode" }));
        assertCanvas();
        assert.equal(count("[data-server-fallback]"), 0);
      },
    );
  } finally {
    await dom.close();
    reset();
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
    livePublishedCheckpointId: 1,
    beforeBlockIds: [],
    afterBlockIds: [],
  };
  Object.assign(globalThis, { testPreviewLayout: layout });
  client.setQueryData(queryKeys.pages.getByPath("/", "draft"), {
    page: { id: 3, status: "draft", livePublishedCheckpointId: 1 },
  });
  const render = (derived?: React.ComponentProps<typeof CamoxPreview>["derived"]) =>
    dom.render(
      <QueryClientProvider client={client}>
        <CamoxPreview derived={derived} source="draft">
          <p data-content>Site content</p>
        </CamoxPreview>
      </QueryClientProvider>,
    );
  try {
    previewStore.send({ type: "enterEditMode" });
    await render();
    const canvas = dom.host.querySelector("[data-canvas]");
    assert.ok(canvas);
    await render({ layoutId: "article", layout });
    assert.equal(dom.host.querySelector("[data-canvas]"), canvas);
    await render();
    assert.equal(dom.host.querySelector("[data-canvas]"), canvas);
  } finally {
    await dom.close();
    client.clear();
    previewStore.send({ type: "exitEditMode" });
    Reflect.deleteProperty(globalThis, "testPreviewLayout");
  }
});
