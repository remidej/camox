import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

import { QueryClient } from "@tanstack/react-query";
import { Window } from "happy-dom";
import * as React from "react";

import type { PageRenderInput } from "../runtime/runtime";
import type { RendererFrameTarget } from "./protocol";

// The page itself is the site's code: a probe stands in for it, showing what the renderer gives
// the page to render with.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.endsWith("/RendererApp.tsx")) {
      for (const name of ["EditablePageContent", "DerivedPageContent"]) {
        if (specifier.endsWith(`/${name}`)) {
          const source = `export const ${name} = (props) => React.createElement(globalThis.PageProbe, { content: ${JSON.stringify(name)}, ...props })`;
          return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
        }
      }
    }
    return nextResolve(specifier, context);
  },
});

const page = { kind: "page", pageId: "home" } as const;

function target(overrides: Partial<RendererFrameTarget> = {}): RendererFrameTarget {
  return {
    pathname: "/",
    href: "http://localhost/",
    owner: page,
    locale: null,
    editable: true,
    artifactsRun: true,
    artifactStudio: null,
    resting: false,
    canvas: null,
    ...overrides,
  };
}

function pageInput(pathname: string, derived?: PageRenderInput["derived"]) {
  return {
    pathname,
    href: `http://localhost${pathname}`,
    previewDocument: "<html><body><div data-camox-preview-root></div></body></html>",
    dehydratedState: { queries: [], mutations: [] },
    ...(derived && { derived }),
  } as unknown as PageRenderInput;
}

async function setup(t: { after: (fn: () => Promise<void> | void) => void }) {
  const dom = new Window({ url: "http://localhost/_camox/renderer" });
  const globals = {
    React,
    window: dom,
    document: dom.document,
    Element: dom.Element,
    HTMLElement: dom.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
    PageProbe,
  };
  const previous = new Map(
    Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  Object.assign(globalThis, globals);
  const { createRoot } = await import("react-dom/client");
  const { StudioQueryClientProvider, testDraftScope, testStudioCache } =
    await import("../../lib/draft-scope.fixtures");
  const { reads } = await import("../../lib/studio-reads");
  const { useFrame } = await import("../preview/components/Frame");
  const { PreviewEditingOwnerContext, usePreviewSelection } =
    await import("../preview/previewSelection");
  const { EditableSurfaceContext } = await import("../../core/hooks/useIsEditable");
  const { useNavigate } = await import("../navigation/navigation");
  const { useApplyContentEdit } = await import("../../core/editing/contentEdits");
  const { previewStore } = await import("../preview/previewStore");
  const { fakeStudio, settle } = await import("./protocol.fixtures");
  const { connectToStudio } = await import("./studioConnection");
  const { RendererApp } = await import("./RendererApp");

  /** What each page rendered with, by the content it is. */
  function PageProbe({ content }: { content: string }) {
    const frame = useFrame();
    const owner = React.use(PreviewEditingOwnerContext);
    const editable = React.use(EditableSurfaceContext);
    const select = usePreviewSelection();
    const navigate = useNavigate();
    const applyEdit = useApplyContentEdit();
    const [saved, setSaved] = React.useState("");
    const edit = () =>
      applyEdit({ type: "blockContent", blockId: "hero", content: { title: "Hello" } }).then(
        () => setSaved("saved"),
        (error: Error) => setSaved(error.message),
      );
    if ((globalThis as { failingPage?: string }).failingPage === frame.window?.location.href)
      throw new Error("The block crashed");
    return (
      <div
        data-probe={content}
        data-owner={owner?.kind === "page" ? owner.pageId : ""}
        data-editable={String(editable)}
        data-own-window={String(frame.window === frame.window?.document.defaultView)}
        data-saved={saved}
      >
        <button data-edit onClick={() => void edit()} />
        <button data-select onClick={() => select({ type: "block", blockId: "hero" })} />
        <button data-navigate onClick={() => void navigate({ to: "/pricing" })} />
      </div>
    );
  }

  const queryClient = new QueryClient();
  const draftScope = testDraftScope(queryClient);
  const studioCache = testStudioCache(queryClient, { draftScope });
  const studio = fakeStudio();
  // The studio shows the Canvas, where pages are selected.
  previewStore.send({ type: "showCanvas" });
  const connection = connectToStudio(studio.handle, { queryClient, studioCache, draftScope });
  const show = (pathname: string, derived?: PageRenderInput["derived"]) =>
    studioCache.set(
      reads.canvasFrame({
        projectUuid: "p",
        runtimeBasePath: "",
        pathname,
        ...(derived && { derivedLayoutId: derived.layoutId }),
      }),
      pageInput(pathname, derived),
    );
  /** A visible frame of the studio: a document of its own, with a slot for the page. */
  const visibleFrame = (url: string) => {
    const frame = new Window({ url });
    const slot = frame.document.createElement("div");
    frame.document.body.append(slot);
    return { frame, slot: slot as unknown as HTMLElement };
  };

  const root = createRoot(dom.document.createElement("div") as unknown as HTMLElement);
  await React.act(async () =>
    root.render(
      <StudioQueryClientProvider client={queryClient} draftScope={draftScope}>
        <RendererApp
          connection={connection}
          camoxApp={{} as never}
          projectUuid="p"
          runtimeBasePath=""
        />
      </StudioQueryClientProvider>,
    ),
  );
  const act = async (fn: () => void | Promise<void>) => {
    await React.act(async () => {
      await fn();
      await settle();
    });
  };
  t.after(async () => {
    await React.act(async () => root.unmount());
    connection.close();
    previewStore.send({ type: "reset" });
    await dom.happyDOM.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  await act(() => {});
  return { studio, show, visibleFrame, act };
}

void test("the renderer renders each frame's page into the slot the studio gave it, until it ends", async (t) => {
  const { studio, show, visibleFrame, act } = await setup(t);
  show("/");
  show("/blog/hello", { layoutId: "article" } as PageRenderInput["derived"]);
  const preview = visibleFrame("http://localhost/");
  const card = visibleFrame("http://localhost/blog/hello");
  await act(() => {
    studio.send({ type: "frame", frameId: "preview", slot: preview.slot, target: target() });
    studio.send({
      type: "frame",
      frameId: "card",
      slot: card.slot,
      target: target({
        pathname: "/blog/hello",
        href: "http://localhost/blog/hello",
        derivedLayoutId: "article",
        owner: { kind: "layout", layoutId: "article" },
        editable: false,
      }),
    });
  });
  const shown = preview.slot.querySelector("[data-probe]");
  assert.equal(shown?.getAttribute("data-probe"), "EditablePageContent");
  assert.equal(shown?.getAttribute("data-owner"), "home");
  assert.equal(shown?.getAttribute("data-editable"), "true");
  assert.equal(shown?.getAttribute("data-own-window"), "true", "the page renders in its frame");
  const derived = card.slot.querySelector("[data-probe]");
  assert.equal(derived?.getAttribute("data-probe"), "DerivedPageContent");
  assert.equal(derived?.getAttribute("data-editable"), "false");
  assert.deepEqual(
    studio.all("rendered").map(({ frameId }) => frameId),
    ["preview", "card"],
  );

  await act(() => studio.send({ type: "frameEnd", frameId: "card" }));
  assert.equal(card.slot.childElementCount, 0);
  assert.ok(preview.slot.querySelector("[data-probe]"), "the other frame keeps its page");
});

void test("a page that throws fails in its own frame, and the studio hears it", async (t) => {
  const { studio, show, visibleFrame, act } = await setup(t);
  show("/");
  show("/broken");
  const preview = visibleFrame("http://localhost/");
  const broken = visibleFrame("http://localhost/broken");
  Object.assign(globalThis, { failingPage: "http://localhost/broken" });
  t.after(() => Reflect.deleteProperty(globalThis, "failingPage"));
  const quiet = t.mock.method(console, "error", () => {});
  await act(() => {
    studio.send({ type: "frame", frameId: "preview", slot: preview.slot, target: target() });
    studio.send({
      type: "frame",
      frameId: "broken",
      slot: broken.slot,
      target: target({ pathname: "/broken", href: "http://localhost/broken" }),
    });
  });
  quiet.mock.restore();
  assert.deepEqual(studio.all("error"), [
    { type: "error", frameId: "broken", message: "The block crashed" },
  ]);
  assert.ok(broken.slot.querySelector("[role=alert]"), "the frame shows its page failed");
  assert.ok(preview.slot.querySelector("[data-probe]"), "the other frame keeps rendering");
});

void test("selecting and navigating in a frame's page goes to the studio", async (t) => {
  const { studio, show, visibleFrame, act } = await setup(t);
  show("/");
  const preview = visibleFrame("http://localhost/");
  await act(() =>
    studio.send({ type: "frame", frameId: "preview", slot: preview.slot, target: target() }),
  );
  await act(() => (preview.slot.querySelector("[data-select]") as HTMLElement).click());
  await act(() => (preview.slot.querySelector("[data-navigate]") as HTMLElement).click());
  assert.deepEqual(
    studio.all("storeEvent").map(({ event }) => event),
    [{ type: "setFocusedBlock", ...page, blockId: "hero" }],
  );
  assert.deepEqual(studio.all("navigate"), [
    { type: "navigate", frameId: "preview", to: "/pricing" },
  ]);
});

void test("an edit made in a frame's page is the studio's to write, and the page hears how it went", async (t) => {
  const { studio, show, visibleFrame, act } = await setup(t);
  const fetched = t.mock.method(globalThis, "fetch", async () => Response.json({ json: null }));
  show("/");
  const preview = visibleFrame("http://localhost/");
  await act(() =>
    studio.send({ type: "frame", frameId: "preview", slot: preview.slot, target: target() }),
  );
  const probe = () => preview.slot.querySelector("[data-probe]")!;
  await act(() => (probe().querySelector("[data-edit]") as HTMLElement).click());
  const [sent] = studio.all("edit");
  assert.deepEqual(sent?.edit, {
    type: "blockContent",
    blockId: "hero",
    content: { title: "Hello" },
  });
  assert.equal(fetched.mock.callCount(), 0, "the renderer never writes content itself");
  await act(() => studio.send({ type: "edited", editId: sent!.editId, error: "Not a member" }));
  assert.equal(probe().getAttribute("data-saved"), "Not a member");
});
