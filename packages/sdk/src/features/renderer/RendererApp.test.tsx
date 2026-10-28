import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

import { QueryClient } from "@tanstack/react-query";
import { Window } from "happy-dom";
import * as React from "react";

import type { CamoxApp } from "../../core/createApp";
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

function pageInput(
  pathname: string,
  derived?: PageRenderInput["derived"],
  previewDocument = "<html><body><div data-camox-preview-root></div></body></html>",
) {
  return {
    pathname,
    href: `http://localhost${pathname}`,
    previewDocument,
    dehydratedState: { queries: [], mutations: [] },
    ...(derived && { derived }),
  } as unknown as PageRenderInput;
}

async function setup(
  t: { after: (fn: () => Promise<void> | void) => void },
  camoxApp: CamoxApp = {} as never,
  codeLoaded?: Promise<void>,
  { signedIn = false }: { signedIn?: boolean } = {},
) {
  const dom = new Window({ url: "http://localhost/_camox/renderer" });
  const globals = {
    React,
    window: dom,
    document: dom.document,
    Element: dom.Element,
    HTMLElement: dom.HTMLElement,
    localStorage: dom.localStorage,
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
  const { useStudioNotice } = await import("../preview/studioNotice");
  const { previewStore } = await import("../preview/previewStore");
  const { fakeStudio, settle } = await import("./protocol.fixtures");
  const { connectToStudio } = await import("./studioConnection");
  const { RendererApp } = await import("./RendererApp");
  const { AuthContext, createCamoxAuthClient } = await import("../../lib/auth");

  /** What each page rendered with, by the content it is. */
  function PageProbe({ content }: { content: string }) {
    const frame = useFrame();
    const owner = React.use(PreviewEditingOwnerContext);
    const editable = React.use(EditableSurfaceContext);
    const select = usePreviewSelection();
    const navigate = useNavigate();
    const applyEdit = useApplyContentEdit();
    const notify = useStudioNotice();
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
        <button
          data-notify
          onClick={() => notify({ tone: "error", message: "Could not delete" })}
        />
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
  const show = (pathname: string, derived?: PageRenderInput["derived"], previewDocument?: string) =>
    studioCache.set(
      reads.canvasFrame({
        projectUuid: "p",
        runtimeBasePath: "",
        pathname,
        ...(derived && { derivedLayoutId: derived.layoutId }),
      }),
      pageInput(pathname, derived, previewDocument),
    );
  /**
   * A visible frame of the studio: a document of its own, with a slot for the page. With `html`,
   * the frame's document is that site document, its root the slot.
   */
  const visibleFrame = (url: string, html?: string) => {
    const frame = new Window({ url });
    if (html) frame.document.write(html);
    const slot =
      frame.document.querySelector("[data-camox-preview-root]") ??
      frame.document.body.appendChild(frame.document.createElement("div"));
    return { frame, slot: slot as unknown as HTMLElement };
  };

  const root = createRoot(dom.document.createElement("div") as unknown as HTMLElement);
  await React.act(async () =>
    root.render(
      <StudioQueryClientProvider client={queryClient} draftScope={draftScope}>
        {/* Only the studio's members load the renderer. */}
        <AuthContext.Provider
          value={{
            projectUuid: "p",
            apiUrl: "http://localhost:8788",
            authenticationUrl: "http://localhost:3290",
            authClient: createCamoxAuthClient("http://localhost:8788"),
            initialAuthenticated: signedIn,
          }}
        >
          <RendererApp
            connection={connection}
            camoxApp={camoxApp}
            codeLoaded={codeLoaded}
            projectUuid="p"
            runtimeBasePath=""
          />
        </AuthContext.Provider>
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

void test("a renderer replaces the page the last renderer left in a frame once its own page renders", async (t) => {
  let loadCode = () => {};
  const codeLoaded = new Promise<void>((resolve) => (loadCode = resolve));
  const { studio, show, visibleFrame, act } = await setup(t, {} as never, codeLoaded);
  show("/");
  const preview = visibleFrame("http://localhost/");
  // A new revision's renderer document replaced the last one, whose page stays in the slot: a
  // removed frame's document never unmounts what it rendered elsewhere.
  const left = preview.slot.appendChild(
    preview.frame.document.createElement("div") as unknown as HTMLElement,
  );

  await act(() =>
    studio.send({ type: "frame", frameId: "preview", slot: preview.slot, target: target() }),
  );
  assert.ok(left.isConnected, "the last page shows while the code loads");

  await act(() => loadCode());
  assert.ok(!left.isConnected, "the last page is gone");
  assert.equal(preview.slot.querySelectorAll("[data-probe]").length, 1);
});

void test("a draft with code's frames take its revision's stylesheets, not Live's the studio loaded them with", async (t) => {
  const { studio, show, visibleFrame, act } = await setup(t);
  const { createCanvasDocument } = await import("../canvas/canvasFrameDocument");
  /** A site document whose head holds `stylesheet`, as the runtime builds one. */
  const siteDocument = (stylesheet: string) =>
    `<!doctype html><html><head><link rel="stylesheet" href="${stylesheet}"></head>` +
    '<body><div id="root" data-camox-preview-root></div></body></html>';
  // The studio page is Live's Worker's: its frames start with Live's stylesheet. The renderer
  // reads the page from the revision, whose build has the draft's classes.
  const live = siteDocument("/assets/site-live.css");
  show("/", undefined, siteDocument("/_camox/r/rev-2/assets/site-draft.css"));
  show("/pricing", undefined, siteDocument("/_camox/r/rev-2/assets/site-draft.css"));
  const preview = visibleFrame("http://localhost/", live);
  // A Canvas card's document is built in the studio, with the studio's own styles beside the site's.
  Object.assign(globalThis, { DOMParser: preview.frame.DOMParser });
  t.after(() => Reflect.deleteProperty(globalThis, "DOMParser"));
  const card = visibleFrame(
    "http://localhost/pricing",
    createCanvasDocument(live, "http://localhost/pricing"),
  );
  const studioStyles = (frame: Window) =>
    [...frame.document.head.querySelectorAll("style")].map((style) => style.textContent);
  const cardStudioStyles = studioStyles(card.frame);
  assert.ok(cardStudioStyles.length > 0, "the card's document holds the studio's styles");

  await act(() => {
    studio.send({ type: "frame", frameId: "preview", slot: preview.slot, target: target() });
    studio.send({
      type: "frame",
      frameId: "card",
      slot: card.slot,
      target: target({ pathname: "/pricing", href: "http://localhost/pricing" }),
    });
  });

  for (const { frame } of [preview, card]) {
    const stylesheets = [...frame.document.head.querySelectorAll('link[rel="stylesheet"]')].map(
      (link) => link.getAttribute("href"),
    );
    assert.deepEqual(stylesheets, ["/_camox/r/rev-2/assets/site-draft.css"]);
  }
  assert.deepEqual(studioStyles(card.frame), cardStudioStyles, "the studio's styles stay");
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

void test("code that fails to load fails each frame, and the studio hears why", async (t) => {
  const failed = Promise.reject(new Error("Unexpected token in Hero.tsx"));
  failed.catch(() => {});
  const quiet = t.mock.method(console, "error", () => {});
  const { studio, show, visibleFrame, act } = await setup(t, {} as never, failed);
  show("/");
  const preview = visibleFrame("http://localhost/");
  await act(() =>
    studio.send({ type: "frame", frameId: "preview", slot: preview.slot, target: target() }),
  );
  quiet.mock.restore();
  assert.deepEqual(studio.all("error"), [
    { type: "error", frameId: "preview", message: "Unexpected token in Hero.tsx" },
  ]);
  assert.match(preview.slot.querySelector("[role=alert]")?.textContent ?? "", /Hero\.tsx/);
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

void test("the renderer renders each block thumbnail with the draft's code, into the slot it is given", async (t) => {
  const { createApp } = await import("../../core/createApp");
  const { createBlock } = await import("../../core/createBlock");
  // A block whose code only the renderer has, lazy as a draft's new block can be.
  const hero = createBlock({
    id: "hero",
    title: "Hero",
    description: "A hero",
    content: (field) => ({ title: field.string({ default: "Welcome aboard" }) }),
    toReact: ({ content }) => <p data-peek>{content.title}</p>,
    toMarkdown: () => [],
    toTitle: () => "Hero",
  });
  const camoxApp = createApp({ blocks: [], lazyBlocks: { hero: async () => hero as never } });
  const { studio, visibleFrame, act } = await setup(t, camoxApp);
  const thumbnail = visibleFrame("http://localhost/");
  await act(() =>
    studio.send({ type: "thumbnail", thumbnailId: "t1", slot: thumbnail.slot, blockType: "hero" }),
  );
  await act(() => {});
  assert.equal(thumbnail.slot.querySelector("[data-peek]")?.textContent, "Welcome aboard");

  await act(() => studio.send({ type: "thumbnailEnd", thumbnailId: "t1" }));
  assert.equal(thumbnail.slot.childElementCount, 0);
});

void test("a thumbnail renders a block's fields, though the renderer document has no router", async (t) => {
  const { createApp } = await import("../../core/createApp");
  const { createBlock } = await import("../../core/createBlock");
  // Fields read the page's location, as site blocks do.
  const hero = createBlock({
    id: "hero",
    title: "Hero",
    description: "A hero",
    content: (field) => ({ title: field.string({ default: "Welcome aboard" }) }),
    toReact: HeroComponent,
    toMarkdown: () => [],
    toTitle: () => "Hero",
  });
  function HeroComponent() {
    return <hero.Field name="title">{(props) => <h1 data-peek {...props} />}</hero.Field>;
  }
  const camoxApp = createApp({ blocks: [hero as never] });
  const quiet = t.mock.method(console, "error", () => {});
  const { studio, visibleFrame, act } = await setup(t, camoxApp);
  const thumbnail = visibleFrame("http://localhost/");
  await act(() =>
    studio.send({ type: "thumbnail", thumbnailId: "t1", slot: thumbnail.slot, blockType: "hero" }),
  );
  quiet.mock.restore();
  assert.equal(thumbnail.slot.querySelector("[data-peek]")?.textContent, "Welcome aboard");
});

void test("a thumbnail whose block throws while rendering shows nothing", async (t) => {
  const { createApp } = await import("../../core/createApp");
  const { createBlock } = await import("../../core/createBlock");
  const hero = createBlock({
    id: "hero",
    title: "Hero",
    description: "A hero",
    content: (field) => ({ title: field.string({ default: "Welcome aboard" }) }),
    toReact: () => {
      throw new Error("The hero crashed");
    },
    toMarkdown: () => [],
    toTitle: () => "Hero",
  });
  const camoxApp = createApp({ blocks: [hero as never] });
  const quiet = t.mock.method(console, "error", () => {});
  // A member, who sees a broken block's error on a page: the session is still being checked.
  t.mock.method(globalThis, "fetch", () => new Promise(() => {}));
  const { studio, visibleFrame, act } = await setup(t, camoxApp, undefined, { signedIn: true });
  const thumbnail = visibleFrame("http://localhost/");
  await act(() =>
    studio.send({ type: "thumbnail", thumbnailId: "t1", slot: thumbnail.slot, blockType: "hero" }),
  );
  quiet.mock.restore();
  assert.equal(thumbnail.slot.textContent, "", "no error strip in place of the preview");
});

void test("what a page tells the editor goes to the studio, which shows it", async (t) => {
  const { studio, show, visibleFrame, act } = await setup(t);
  show("/");
  const preview = visibleFrame("http://localhost/");
  await act(() =>
    studio.send({ type: "frame", frameId: "preview", slot: preview.slot, target: target() }),
  );
  await act(() => (preview.slot.querySelector("[data-notify]") as HTMLElement).click());
  assert.deepEqual(studio.all("notify"), [
    { type: "notify", notice: { tone: "error", message: "Could not delete" } },
  ]);
});

void test("a thumbnail whose code fails to load shows nothing, and the pages keep rendering", async (t) => {
  const { createApp } = await import("../../core/createApp");
  const camoxApp = createApp({
    blocks: [],
    lazyBlocks: {
      hero: async () => {
        throw new Error("Hero.tsx failed to load");
      },
    },
  });
  const quiet = t.mock.method(console, "error", () => {});
  const { studio, show, visibleFrame, act } = await setup(t, camoxApp);
  show("/");
  const preview = visibleFrame("http://localhost/");
  const thumbnail = visibleFrame("http://localhost/");
  await act(() => {
    studio.send({ type: "frame", frameId: "preview", slot: preview.slot, target: target() });
    studio.send({ type: "thumbnail", thumbnailId: "t1", slot: thumbnail.slot, blockType: "hero" });
  });
  await act(() => {});
  quiet.mock.restore();
  assert.equal(thumbnail.slot.textContent, "");
  assert.ok(preview.slot.querySelector("[data-probe]"), "the page keeps rendering");
});
