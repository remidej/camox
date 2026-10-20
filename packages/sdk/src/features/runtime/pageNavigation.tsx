import { type DehydratedState, hydrate, type QueryClient } from "@tanstack/react-query";
import { createHead, renderDOMHead } from "@unhead/react/client";
import * as React from "react";
import type { ActiveHeadEntry, UseHeadInput } from "unhead/types";

import type { CamoxApp } from "../../core/createApp";
import { draftNamedBy, DraftScopeContext } from "../../lib/draft-scope";
import type { LocaleView } from "../../lib/locale-path";
import { reads } from "../../lib/studio-reads";
import { type ViewLocale, ViewLocaleContext } from "../../lib/view-locale";
import { PageAlternatesContext } from "../../lib/view-locale-context";
import { NavigationProvider, type NavigateOptions } from "../navigation/navigation";
import { sendPageView } from "./analytics";
import { createPrefetchCache, listenForLinkIntent } from "./linkPrefetch";
import { createRouteAnnouncer, focusNewPage } from "./navigationAccessibility";
import { createNavigationRequestTracker } from "./navigationRequest";
import { fetchRuntimeJson, getNavigationTarget } from "./navigationTarget";
import { getPageBlockTypes } from "./pageBlockTypes";
import { type PageViewport, PageViewportContext } from "./pageViewport";
import { createPageHeadInput, type LayoutIdentity, type PageRenderInput } from "./runtime";
import {
  createScrollRestoration,
  type ScrollIntent,
  type ScrollRestoration,
} from "./scrollRestoration";

function preserveStableLayoutBlockCaches(
  dehydratedState: unknown,
  current: LayoutIdentity | null,
  next: LayoutIdentity | null,
) {
  if (!current || !next || current.layoutId !== next.layoutId || current.version !== next.version)
    return dehydratedState;
  if (
    !dehydratedState ||
    typeof dehydratedState !== "object" ||
    !("queries" in dehydratedState) ||
    !Array.isArray(dehydratedState.queries)
  )
    return dehydratedState;
  const ids = new Set(current.blockIds);
  return {
    ...dehydratedState,
    queries: dehydratedState.queries.filter((query: { queryKey?: unknown[] }) => {
      const blockId = query.queryKey && reads.blockBundle.paramsOf(query.queryKey);
      return !(blockId && ids.has(blockId));
    }),
  };
}

function sameLocale(a: LocaleView, b: LocaleView) {
  return a.tag === b.tag && a.isDefault === b.isDefault;
}

function prefetchKey(pathname: string, draft: string | null) {
  return JSON.stringify({ pathname, draft });
}

export function PageNavigationProvider({
  camoxApp,
  children,
  initialInput,
  queryClient,
}: {
  camoxApp: Pick<CamoxApp, "loadBlocks">;
  children: (input: PageRenderInput) => React.ReactNode;
  initialInput: PageRenderInput;
  queryClient: QueryClient;
}) {
  const draftScope = React.useContext(DraftScopeContext);
  if (!draftScope) throw new Error("PageNavigationProvider needs a DraftScopeContext provider");
  // Provenance belongs to the committed location, not the payload or browser history. Each
  // switch to another draft starts a new generation, which mounts the page afresh so every query
  // reads that draft's keys.
  const [{ input, source, generation }, setLocation] = React.useState<{
    input: PageRenderInput;
    source?: NavigateOptions["source"];
    generation: number;
  }>(() => {
    // Before anything reads the draft, follow what the server rendered: in the browser, a draft
    // it couldn't show leaves the URL.
    draftScope.adopt(initialInput);
    return { input: initialInput, generation: 0 };
  });
  const current = React.useRef(initialInput);
  const [requests] = React.useState(createNavigationRequestTracker);
  // A visitor's page scrolls the window. A member's shows in a Studio frame, which takes part
  // through PageViewportContext.
  const ownsWindow = initialInput.presentation !== "studio";
  const scroll = React.useRef<ScrollRestoration | null>(null);
  // Only ever called in the browser.
  const restoration = React.useCallback(
    () => (scroll.current ??= createScrollRestoration(window)),
    [],
  );
  /** How the page at `href` scrolls once shown, until whatever shows it takes it. */
  const pendingScroll = React.useRef<{ href: string; intent: ScrollIntent } | null>(null);
  const takeScroll = (href: string) => {
    const pending = pendingScroll.current;
    if (pending?.href !== href) return null;
    pendingScroll.current = null;
    return pending.intent;
  };
  /** Scrolls `viewport`, which just rendered the page at `href`, then moves focus into it. */
  const position = React.useCallback(
    (viewport: Window, intent: ScrollIntent, href: string) => {
      const fragment = restoration().apply(viewport, intent, new URL(href).hash);
      // Within the page, focus only moves to a fragment it has.
      if (intent !== "resume" && (fragment || intent !== "fragment"))
        focusNewPage(viewport.document, fragment);
    },
    [restoration],
  );
  /** The path of the page navigated to, read out once it shows. */
  const pendingAnnouncement = React.useRef<string | null>(null);
  const announcer = React.useRef<ReturnType<typeof createRouteAnnouncer> | null>(null);

  /** Reads the page at `pathname` from `draft`, once the blocks it shows can render. */
  const loadPage = React.useCallback(
    async (pathname: string, draft: string | null, signal: AbortSignal) => {
      const response = await fetchRuntimeJson(
        draftScope,
        "/_camox/data",
        initialInput.runtimeBasePath,
        { path: pathname },
        draft,
        signal,
      );
      if (!response.ok) throw new Error(`Navigation failed: ${response.status}`);
      const next = (await response.json()) as PageRenderInput;
      if (next.pathname !== pathname || !next.dehydratedState)
        throw new Error("Invalid navigation response");
      await camoxApp.loadBlocks(getPageBlockTypes(next.dehydratedState));
      return next;
    },
    [camoxApp, draftScope, initialInput.runtimeBasePath],
  );
  const [prefetched] = React.useState(() => createPrefetchCache<PageRenderInput>());
  const headManager = React.useRef<{
    head: ReturnType<typeof createHead>;
    entry?: ActiveHeadEntry<UseHeadInput>;
  } | null>(null);

  // The server loaded the providers' scripts for a visitor only, and says so in the first input.
  const { analytics } = initialInput;

  const navigate = React.useCallback(
    async ({
      to,
      replace,
      source,
      draft,
      pop = false,
      refresh = false,
    }: NavigateOptions & { pop?: boolean; refresh?: boolean }) => {
      const request = requests.begin();
      // Every navigation keeps the viewed draft unless it switches drafts. History traversal
      // already restored the URL it goes to.
      const href = pop ? to : draftScope.hrefFor(to, { from: window.location.href, draft });
      const target = getNavigationTarget(href, window.location.href, initialInput.runtimeBasePath);
      if (!target) {
        if (replace) window.location.replace(to);
        else window.location.assign(to);
        return;
      }
      // Back and forward already show another entry: keep where the one left was scrolled to.
      if (pop) restoration().save();

      // Selecting the current page is still a navigation intent: begin() above
      // cancels an in-flight selection, but must not add a duplicate history entry.
      // Like the browser, following a link to the fragment shown scrolls to it again.
      if (!pop && !refresh && target.url.href === current.current.href) {
        const viewport = restoration().viewport();
        if (target.url.hash && viewport) position(viewport, "fragment", target.url.href);
        return;
      }

      try {
        let next = current.current;
        const targetDraft = draftNamedBy(target.url.href);
        // Hash/search-only changes need no new route payload, unless they switch drafts.
        const fetched =
          target.pathname !== next.pathname || refresh || targetDraft !== draftNamedBy(next.href);
        if (fetched) {
          // Keep the current page until the next one's blocks can render. A page loaded ahead
          // serves the navigation, unless it refreshes what's shown.
          next = await ((!refresh && prefetched.take(prefetchKey(target.pathname, targetDraft))) ||
            loadPage(target.pathname, targetDraft, request.signal));
        }
        if (!request.isCurrent()) return;
        // Another draft or locale shows other keys: the page mounts afresh to read them.
        const switching =
          (next.draftId ?? null) !== (current.current.draftId ?? null) ||
          !sameLocale(next.locale, current.current.locale);
        // Back and forward already moved the browser's history.
        const positions = restoration();
        if (!pop) {
          if (replace || refresh) {
            window.history.replaceState(window.history.state, "", target.url.href);
          } else {
            positions.save();
            window.history.pushState(positions.stateForNewEntry(), "", target.url.href);
          }
        }
        positions.entered();
        // A replaced entry keeps its position, unless the page changes.
        const intent: ScrollIntent | null = pop
          ? "restore"
          : refresh || (replace && !fetched)
            ? null
            : fetched
              ? "enter"
              : "fragment";
        pendingScroll.current = intent && { href: window.location.href, intent };
        pendingAnnouncement.current = fetched && !refresh ? next.pathname : null;
        // The page couldn't show the draft, so it showed Live: the URL drops the draft too.
        if (fetched) draftScope.adopt(next);
        hydrate(
          queryClient,
          (switching
            ? next.dehydratedState
            : preserveStableLayoutBlockCaches(
                next.dehydratedState,
                current.current.layoutIdentity,
                next.layoutIdentity,
              )) as DehydratedState,
        );
        next = { ...next, href: window.location.href };
        const previous = current.current;
        current.current = next;

        if (!headManager.current) {
          document
            .querySelectorAll("[data-camox-page-head]")
            .forEach((element) => element.remove());
          headManager.current = { head: createHead() };
        }
        const manager = headManager.current;
        manager.entry?.dispose();
        manager.entry = manager.head.push(
          createPageHeadInput((next.head ?? {}) as Parameters<typeof createPageHeadInput>[0]),
        );
        renderDOMHead(manager.head);
        // The new page's title is in place: count the page the visitor moved to. The URL changed
        // before the title, so the providers' own history tracking would record the previous one.
        if (ownsWindow && analytics && next.pathname !== previous.pathname)
          sendPageView(analytics, window);
        // A visitor's document speaks the page's language. A member's is the Studio's: the page's
        // frame renders with its own `<html lang>`.
        if (ownsWindow) document.documentElement.lang = next.locale.tag;
        React.startTransition(() =>
          setLocation((location) => ({
            input: next,
            source: pop ? undefined : source,
            generation: location.generation + (switching ? 1 : 0),
          })),
        );
      } catch {
        if (!request.isCurrent()) return;
        if (pop) window.location.reload();
        else if (replace) window.location.replace(target.url.href);
        else window.location.assign(target.url.href);
      }
    },
    [
      analytics,
      draftScope,
      initialInput.runtimeBasePath,
      loadPage,
      ownsWindow,
      position,
      prefetched,
      queryClient,
      requests,
      restoration,
    ],
  );

  const prefetchLink = React.useCallback(
    (anchor: HTMLAnchorElement) => {
      if (anchor.hasAttribute("download") || (anchor.target && anchor.target !== "_self")) return;
      const href = draftScope.hrefFor(anchor.href, { from: window.location.href });
      const target = getNavigationTarget(href, window.location.href, initialInput.runtimeBasePath);
      if (!target || target.pathname === current.current.pathname) return;
      const draft = draftNamedBy(target.url.href);
      // Whichever navigation takes this load awaits it, so none of them aborts it.
      prefetched.prefetch(prefetchKey(target.pathname, draft), () =>
        loadPage(target.pathname, draft, new AbortController().signal),
      );
    },
    [draftScope, initialInput.runtimeBasePath, loadPage, prefetched],
  );

  const pageViewport = React.useMemo<PageViewport>(
    () => ({
      opened(viewport, href) {
        restoration().apply(viewport, takeScroll(href) ?? "restore", new URL(href).hash);
      },
      placed(href) {
        takeScroll(href);
      },
      attach(viewport) {
        restoration().setViewport(viewport);
        return () => {
          const positions = restoration();
          if (positions.viewport() === viewport) positions.setViewport(ownsWindow ? window : null);
        };
      },
      prefetchLink,
    }),
    // takeScroll only reads refs.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [ownsWindow, position, prefetchLink, restoration],
  );

  React.useEffect(() => {
    const positions = restoration();
    if (ownsWindow) {
      positions.setViewport(window);
      // Reloaded, or back to an entry whose document the browser had to load again.
      positions.apply(window, "resume", window.location.hash);
    }
    announcer.current = createRouteAnnouncer(document);
    return () => {
      announcer.current?.dispose();
      announcer.current = null;
      scroll.current?.dispose();
      scroll.current = null;
    };
  }, [ownsWindow, restoration]);

  // Count the page the visitor opened.
  const firstPageView = React.useRef(false);
  React.useEffect(() => {
    if (!ownsWindow || !analytics || firstPageView.current) return;
    firstPageView.current = true;
    sendPageView(analytics, window);
  }, [analytics, ownsWindow]);

  React.useEffect(() => {
    if (!ownsWindow) return;
    const stopListening = listenForLinkIntent(document, prefetchLink);
    return stopListening;
  }, [ownsWindow, prefetchLink]);

  React.useEffect(() => {
    // Pages loaded for one draft never serve another.
    const unsubscribe = draftScope.subscribe(() => prefetched.clear());
    return () => {
      unsubscribe();
      prefetched.clear();
    };
  }, [draftScope, prefetched]);

  // The next page has rendered, in the window or the Studio frame showing it: scroll it before
  // the browser paints it, then read out its name.
  React.useLayoutEffect(() => {
    const intent = takeScroll(input.href);
    const viewport = scroll.current?.viewport();
    if (intent && viewport) position(viewport, intent, input.href);
    const announced = pendingAnnouncement.current;
    pendingAnnouncement.current = null;
    if (announced) {
      const viewport = scroll.current?.viewport();
      announcer.current?.announce(viewport?.document ?? document, announced);
    }
    // takeScroll only reads refs.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [input]);

  React.useEffect(() => {
    // Child effects may clean sign-in parameters during hydration. The browser
    // also owns the fragment, which SSR never sees. Adopt both before later
    // navigations preserve a stale search/hash from the server payload. A draft
    // started by the first edit also lands in the URL in place.
    const adoptBrowserUrl = () => {
      const url = new URL(window.location.href);
      if (
        url.href === current.current.href ||
        url.pathname !== new URL(current.current.href).pathname
      )
        return;
      const next = {
        ...current.current,
        href: url.href,
        draftId: draftScope.current() ?? undefined,
      };
      current.current = next;
      setLocation((location) => ({ ...location, input: next }));
    };
    adoptBrowserUrl();
    return draftScope.subscribe(({ move }) => {
      if (move === "started") return adoptBrowserUrl();
      // The draft ended: show the page afresh, as Live shows it now.
      if (move === "left") void navigate({ to: window.location.href, refresh: true });
    });
  }, [draftScope, navigate]);

  React.useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey
      )
        return;
      const anchor = (event.target as Element | null)?.closest("a");
      if (
        !anchor ||
        anchor.hasAttribute("download") ||
        (anchor.target && anchor.target !== "_self")
      )
        return;
      if (!getNavigationTarget(anchor.href, window.location.href, initialInput.runtimeBasePath))
        return;
      event.preventDefault();
      void navigate({ to: anchor.href });
    };
    const onPopState = () => void navigate({ to: window.location.href, pop: true });
    document.addEventListener("click", onClick);
    window.addEventListener("popstate", onPopState);
    return () => {
      document.removeEventListener("click", onClick);
      window.removeEventListener("popstate", onPopState);
      requests.cancel();
    };
  }, [navigate, initialInput.runtimeBasePath, requests]);

  const url = new URL(input.href);
  // Each render's response is new JSON: keep the value while it says the same.
  const viewLocaleJson = JSON.stringify({ locale: input.locale, locales: input.locales });
  const viewLocale = React.useMemo<ViewLocale>(() => JSON.parse(viewLocaleJson), [viewLocaleJson]);
  const alternatesJson = JSON.stringify(input.alternates ?? null);
  const alternates = React.useMemo(
    () => JSON.parse(alternatesJson) as PageRenderInput["alternates"] | null,
    [alternatesJson],
  );
  return (
    <NavigationProvider
      location={{
        href: input.href,
        pathname: input.pathname,
        hash: url.hash,
        search: url.search,
        source,
      }}
      navigate={navigate}
    >
      <ViewLocaleContext value={viewLocale}>
        <PageAlternatesContext value={alternates ?? null}>
          <PageViewportContext value={pageViewport}>
            <React.Fragment key={generation}>{children(input)}</React.Fragment>
          </PageViewportContext>
        </PageAlternatesContext>
      </ViewLocaleContext>
    </NavigationProvider>
  );
}
