import assert from "node:assert/strict";
import { test } from "node:test";

import { QueryClient } from "@tanstack/react-query";
import { Window } from "happy-dom";
import * as React from "react";

import type { StudioHandle } from "./protocol";

const page = { kind: "page", pageId: "home" } as const;

async function setup(t: { after: (fn: () => Promise<void> | void) => void }, draft: string | null) {
  // The renderer document never loads: a fake renderer connects in its place.
  const dom = new Window({
    url: "http://localhost/about",
    settings: { disableIframePageLoading: true },
  });
  const globals = {
    React,
    window: dom,
    document: dom.document,
    Element: dom.Element,
    HTMLElement: dom.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = new Map(
    Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  Object.assign(globalThis, globals);
  const { createRoot } = await import("react-dom/client");
  const { createPortal } = await import("react-dom");
  const { StudioQueryClientProvider, testDraftScope } =
    await import("../../lib/draft-scope.fixtures");
  const { NavigationProvider } = await import("../navigation/navigation");
  const { PreviewEditingOwnerContext } = await import("../preview/previewSelection");
  const { EditableSurfaceContext } = await import("../../core/hooks/useIsEditable");
  const { previewStore } = await import("../preview/previewStore");
  const { fakeRenderer, settle } = await import("./protocol.fixtures");
  const { STUDIO_HANDLE_KEY } = await import("./protocol");
  const { RendererFramesProvider, RendererSlot } = await import("./RendererFrames");
  const { createRevisions, RevisionsContext } = await import("../../lib/revisions");
  const revisions = createRevisions();

  const queryClient = new QueryClient();
  const draftScope = testDraftScope(queryClient);
  if (draft) draftScope.adopt({ draftId: draft });
  /** A visible frame of the Website Section: a document of its own. */
  const visible = new Window({ url: "http://localhost/about" });
  const navigations: unknown[] = [];
  const rendered: string[] = [];
  const container = dom.document.createElement("div");
  dom.document.body.append(container);
  const root = createRoot(container as unknown as HTMLElement);
  const render = (slot: boolean) =>
    React.act(async () =>
      root.render(
        <StudioQueryClientProvider client={queryClient} draftScope={draftScope}>
          <RevisionsContext value={revisions}>
            <RendererFramesProvider runtimeBasePath="">
              <NavigationProvider
                location={{
                  href: "http://localhost/about",
                  pathname: "/about",
                  search: "",
                  hash: "",
                }}
                navigate={(options) => void navigations.push(options)}
              >
                <PreviewEditingOwnerContext value={page}>
                  <EditableSurfaceContext value={false}>
                    {slot &&
                      createPortal(
                        <RendererSlot
                          pathname="/about"
                          onRendered={() => rendered.push("/about")}
                        />,
                        visible.document.body as unknown as HTMLElement,
                      )}
                  </EditableSurfaceContext>
                </PreviewEditingOwnerContext>
              </NavigationProvider>
            </RendererFramesProvider>
          </RevisionsContext>
        </StudioQueryClientProvider>,
      ),
    );
  await render(true);
  const rendererFrame = () =>
    dom.document.querySelector("iframe[data-camox-renderer]") as unknown as
      | (HTMLIFrameElement & { [STUDIO_HANDLE_KEY]?: StudioHandle })
      | null;
  t.after(async () => {
    await React.act(async () => root.unmount());
    previewStore.send({ type: "reset" });
    await dom.happyDOM.close();
    await visible.happyDOM.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  const act = async (fn: () => void | Promise<void>) =>
    React.act(async () => {
      await fn();
      await settle();
    });
  return {
    draftScope,
    visible,
    rendererFrame,
    render,
    navigations,
    rendered,
    act,
    fakeRenderer,
    revisions,
  };
}

void test("the Website Section loads one hidden renderer frame, at the renderer document of the draft viewed", async (t) => {
  const { rendererFrame } = await setup(t, "spring");
  const frame = rendererFrame();
  assert.ok(frame);
  assert.equal(frame.hidden, true);
  assert.equal(frame.getAttribute("src"), "/_camox/renderer?camox-draft=spring");
  assert.ok(frame.__camoxStudio, "the frame holds the studio's handle for the renderer to connect");
});

void test("a frame's slot shows its page through the renderer, as the studio's frame says", async (t) => {
  const { rendererFrame, visible, render, navigations, rendered, act, fakeRenderer } = await setup(
    t,
    null,
  );
  const renderer = fakeRenderer(rendererFrame()!.__camoxStudio!);
  await act(() => {});
  const frame = renderer.last("frame");
  assert.equal(frame?.slot.ownerDocument, visible.document as unknown as Document);
  assert.deepEqual(frame?.target, {
    pathname: "/about",
    href: "http://localhost/about",
    owner: page,
    locale: null,
    editable: false,
    artifactsRun: true,
    artifactStudio: null,
    resting: false,
    canvas: null,
  });
  await act(() => {
    renderer.send({ type: "rendered", frameId: frame!.frameId });
    renderer.send({ type: "navigate", frameId: frame!.frameId, to: "/pricing" });
  });
  assert.deepEqual(rendered, ["/about"]);
  assert.deepEqual(navigations, [{ to: "/pricing" }]);

  await render(false);
  await act(() => {});
  assert.deepEqual(renderer.last("frameEnd"), { type: "frameEnd", frameId: frame!.frameId });
});

void test("moving to another draft loads another renderer; a draft a first write starts keeps it", async (t) => {
  const { draftScope, rendererFrame, act } = await setup(t, null);
  const live = rendererFrame();
  await act(() => void draftScope.enterStarted("fresh"));
  assert.equal(rendererFrame(), live, "the started draft shows what Live did");
  await act(() => draftScope.adopt({ draftId: "autumn" }));
  assert.equal(rendererFrame()?.getAttribute("src"), "/_camox/renderer?camox-draft=autumn");
  assert.notEqual(rendererFrame(), live);
});

void test("a revision of a draft a first write started loads that draft's renderer, not Live's", async (t) => {
  const { draftScope, rendererFrame, act, revisions } = await setup(t, null);
  await act(() => void draftScope.enterStarted("fresh"));
  await act(() => revisions.announce({ draftId: "fresh", revisionId: "r1", sdkVersion: "1" }));
  assert.equal(rendererFrame()?.getAttribute("src"), "/_camox/renderer?camox-draft=fresh");
});

void test("with a renderer of another SDK version, the frames say they're updating", async (t) => {
  const { rendererFrame, visible, act, fakeRenderer } = await setup(t, null);
  const { SDK_VERSION } = await import("./protocol");
  const renderer = fakeRenderer(rendererFrame()!.__camoxStudio!, {
    sdkVersion: `${SDK_VERSION}-other`,
  });
  await act(() => {});
  assert.equal(renderer.last("frame"), undefined);
  assert.match(visible.document.body.textContent ?? "", /updating/i);
});

void test("a new revision of the shown draft loads another renderer, which keeps the Canvas position and selection", async (t) => {
  const { rendererFrame, act, fakeRenderer, revisions } = await setup(t, "spring");
  const { previewStore, selectionForOwner } = await import("../preview/previewStore");
  const { canvasStore } = await import("../canvas/canvasStore");
  t.after(() => canvasStore.send({ type: "reset" }));
  const first = rendererFrame();
  fakeRenderer(first!.__camoxStudio!);
  await act(() => {
    previewStore.send({ type: "setFocusedBlock", ...page, blockId: "hero" });
    canvasStore.send({
      type: "rememberView",
      workspaceKey: "pages",
      view: { camera: { x: 120, y: -40, scale: 0.5 }, fitted: false },
    });
  });

  await act(() => revisions.announce({ draftId: "autumn", revisionId: "r1", sdkVersion: "1" }));
  assert.equal(rendererFrame(), first, "another draft's revision changes nothing");

  await act(() => revisions.announce({ draftId: "spring", revisionId: "r2", sdkVersion: "1" }));
  const reloaded = rendererFrame();
  assert.ok(reloaded);
  assert.notEqual(reloaded, first);
  assert.equal(reloaded.getAttribute("src"), "/_camox/renderer?camox-draft=spring");

  const renderer = fakeRenderer(reloaded.__camoxStudio!);
  await act(() => {});
  const preview = renderer
    .all("store")
    .filter(({ store }) => store === "preview")
    .at(-1);
  const canvas = renderer
    .all("store")
    .filter(({ store }) => store === "canvas")
    .at(-1);
  assert.deepEqual(
    selectionForOwner(preview?.context as Parameters<typeof selectionForOwner>[0], page),
    { type: "block", blockId: "hero" },
  );
  assert.deepEqual(
    (canvas!.context as ReturnType<typeof canvasStore.getSnapshot>["context"]).views.pages,
    { camera: { x: 120, y: -40, scale: 0.5 }, fitted: false },
  );
  assert.ok(renderer.last("frame"), "the new renderer renders the frames shown");
});

void test("frames updating for another SDK version recover once a revision of the studio's version loads", async (t) => {
  const { rendererFrame, visible, act, fakeRenderer, revisions } = await setup(t, "spring");
  const { SDK_VERSION } = await import("./protocol");
  fakeRenderer(rendererFrame()!.__camoxStudio!, { sdkVersion: `${SDK_VERSION}-other` });
  await act(() => {});
  assert.match(visible.document.body.textContent ?? "", /updating/i);

  await act(() =>
    revisions.announce({ draftId: "spring", revisionId: "r2", sdkVersion: SDK_VERSION }),
  );
  const renderer = fakeRenderer(rendererFrame()!.__camoxStudio!);
  await act(() => {});
  assert.doesNotMatch(visible.document.body.textContent ?? "", /updating/i);
  assert.ok(renderer.last("frame"));
});
