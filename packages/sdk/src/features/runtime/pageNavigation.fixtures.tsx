import type { test } from "node:test";

import { QueryClient, dehydrate } from "@tanstack/react-query";
import { Window } from "happy-dom";
import * as React from "react";

import { createApp } from "../../core/createApp";
import { StudioScopeProvider } from "../../lib/draft-scope.fixtures";
import { Frame } from "../preview/components/Frame";
import { PageNavigationProvider } from "./pageNavigation";
import type { PageRenderInput } from "./runtime";

type HappyWindow = InstanceType<typeof Window>;

/**
 * A website whose pages each link to the others and hold a `#details` section, open in a
 * visitor's window, or with `studio`, in a member's window, where the page shows in Studio's frame.
 * The page's viewport is the window the page scrolls in: the visitor's, or the frame's.
 */
export async function openPage(
  t: test.TestContext,
  url: string,
  { studio = false }: { studio?: boolean } = {},
) {
  const window = new Window({ url });
  Object.assign(globalThis, {
    React,
    window,
    document: window.document,
    location: window.location,
    HTMLElement: window.HTMLElement,
    Element: window.Element,
    Node: window.Node,
    MutationObserver: window.MutationObserver,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  document.body.innerHTML = '<div id="root"></div>';
  const queryClient = new QueryClient();
  const input = (pathname: string): PageRenderInput => ({
    presentation: studio ? "studio" : "public",
    apiUrl: "https://api.test",
    authenticationUrl: "https://auth.test",
    projectSlug: "test",
    href: new URL(pathname, url).href,
    pathname,
    runtimeBasePath: "",
    head: { meta: [{ title: `Title of ${pathname}` }] },
    layoutIdentity: null,
    loaderData: null,
    dehydratedState: dehydrate(new QueryClient()),
  });
  const dataRequests: string[] = [];
  t.mock.method(globalThis, "fetch", async (request: URL | RequestInfo) => {
    const requested = new URL(request instanceof Request ? request.url : request);
    const pathname = requested.searchParams.get("path")!;
    dataRequests.push(pathname);
    return Response.json(input(pathname));
  });

  /** Each scroll of the viewport, with the page shown when it happened. */
  const scrolls: { page: string | undefined; top: number; behavior?: string }[] = [];
  const fragmentScrolls: { id: string; behavior?: string }[] = [];
  /** Scrolls of a Studio window, which never shows the page itself. */
  const studioScrolls: unknown[] = [];
  /** Scrolls as the visitor does, unrecorded. */
  const userScrolls = new Map<HappyWindow, (options: ScrollToOptions) => void>();
  const spyOnScrolls = (target: HappyWindow) => {
    const scrollTo = target.scrollTo.bind(target);
    userScrolls.set(target, (options) => scrollTo(options as never));
    t.mock.method(target, "scrollTo", (options: ScrollToOptions) => {
      if (studio && target === window) studioScrolls.push(options);
      else scrolls.push({ page: shownPage(), top: options.top ?? 0, behavior: options.behavior });
      scrollTo(options as never);
    });
    t.mock.method(
      target.Element.prototype,
      "scrollIntoView",
      function (this: Element, options?: ScrollIntoViewOptions) {
        fragmentScrolls.push({ id: this.id, behavior: options?.behavior });
      },
    );
  };
  spyOnScrolls(window);
  let frame: HappyWindow | null = null;
  const viewport = () => frame ?? window;
  const shownPage = () => viewport().document.querySelector("main")?.dataset.page;

  const page = (input: PageRenderInput) => (
    <main data-page={input.pathname}>
      <a id="to-about" href="/about">
        About
      </a>
      <a id="to-pricing" href="/pricing">
        Pricing <span id="pricing-label">plans</span>
      </a>
      <a id="to-pricing-details" href="/pricing#details">
        Pricing details
      </a>
      <a id="to-details" href="#details">
        Details
      </a>
      <a id="to-missing" href="#missing">
        Missing
      </a>
      <section id="details" />
    </main>
  );

  const { createRoot } = await import("react-dom/client");
  let root: ReturnType<typeof createRoot> | null = null;
  const mount = async () => {
    root = createRoot(document.getElementById("root")!);
    const initial = { ...input(window.location.pathname), href: window.location.href };
    await React.act(async () => {
      root!.render(
        <StudioScopeProvider client={queryClient}>
          <PageNavigationProvider
            camoxApp={createApp({ blocks: [] })}
            initialInput={initial}
            queryClient={queryClient}
          >
            {(input) => (studio ? <Frame>{page(input)}</Frame> : page(input))}
          </PageNavigationProvider>
        </StudioScopeProvider>,
      );
    });
    if (!studio) return;
    // Happy DOM doesn't load srcdoc: give the iframe a fresh document of its own.
    const opened = new Window({ url: window.location.href });
    opened.document.body.innerHTML = "<div data-camox-preview-root></div>";
    spyOnScrolls(opened);
    frame = opened;
    const iframe = document.querySelector("iframe")!;
    Object.defineProperty(iframe, "contentDocument", { value: opened.document });
    Object.defineProperty(iframe, "contentWindow", { value: opened });
    await React.act(async () => {
      iframe.dispatchEvent(new window.Event("load") as never);
    });
  };
  const unmount = async () => {
    await React.act(async () => root?.unmount());
    root = null;
    await frame?.happyDOM.close();
    frame = null;
  };
  await mount();
  t.after(async () => {
    await unmount();
    queryClient.clear();
    await window.happyDOM.close();
  });

  const settle = () =>
    React.act(async () => {
      for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
    });

  return {
    window,
    viewport: () => viewport() as unknown as Window,
    dataRequests,
    scrolls,
    fragmentScrolls,
    studioScrolls,
    shownPage,
    element: (id: string) => viewport().document.getElementById(id)! as unknown as HTMLElement,
    /** The element focus is on, in the viewport. */
    focused: () => viewport().document.activeElement as unknown as Element | null,
    announced: () => document.querySelector("[data-camox-route-announcer]")?.textContent,
    async click(id: string) {
      await React.act(async () => {
        (viewport().document.getElementById(id) as unknown as HTMLElement).click();
      });
      await settle();
    },
    /** Scrolls the page, as the visitor would. */
    scrollBy(top: number) {
      userScrolls.get(viewport())!({ top: viewport().scrollY + top });
    },
    /** Happy DOM doesn't traverse history: reproduce the browser's URL and state update. */
    async traverse(href: string, state: unknown) {
      window.history.replaceState(state as object | null, "", href);
      await React.act(async () => {
        window.dispatchEvent(
          new window.PopStateEvent("popstate", { state: state as object | null }),
        );
      });
      await settle();
    },
    /** Leaves and loads the document again, in the same tab. */
    async reload() {
      window.dispatchEvent(new window.Event("pagehide"));
      await unmount();
      // The new document opens at its top, unless something restores its position.
      userScrolls.get(window)!({ top: 0 });
      await mount();
    },
    settle,
  };
}
