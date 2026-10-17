import { type DehydratedState, hydrate, type QueryClient } from "@tanstack/react-query";
import { createHead, renderDOMHead } from "@unhead/react/client";
import * as React from "react";
import type { ActiveHeadEntry, UseHeadInput } from "unhead/types";

import type { CamoxApp } from "../../core/createApp";
import { draftNamedBy, DraftScopeContext } from "../../lib/draft-scope";
import { NavigationProvider, type NavigateOptions } from "../navigation/navigation";
import { createNavigationRequestTracker } from "./navigationRequest";
import { fetchRuntimeJson, getNavigationTarget } from "./navigationTarget";
import { getPageBlockTypes } from "./pageBlockTypes";
import { createPageHeadInput, type LayoutIdentity, type PageRenderInput } from "./runtime";

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
      const key = query.queryKey;
      return !(
        key?.[0] === "camox" &&
        key[1] === "blocks" &&
        key[2] === "get" &&
        typeof key[3] === "string" &&
        ids.has(key[3])
      );
    }),
  };
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
  const headManager = React.useRef<{
    head: ReturnType<typeof createHead>;
    entry?: ActiveHeadEntry<UseHeadInput>;
  } | null>(null);

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

      // Selecting the current page is still a navigation intent: begin() above
      // cancels an in-flight selection, but must not add a duplicate history entry.
      if (!pop && !refresh && target.url.href === current.current.href) return;

      try {
        let next = current.current;
        const targetDraft = draftNamedBy(target.url.href);
        // Hash/search-only changes need no new route payload, unless they switch drafts.
        const fetched =
          target.pathname !== next.pathname ||
          pop ||
          refresh ||
          targetDraft !== draftNamedBy(next.href);
        if (fetched) {
          const response = await fetchRuntimeJson(
            draftScope,
            "/_camox/data",
            initialInput.runtimeBasePath,
            { path: target.pathname },
            request.signal,
            targetDraft,
          );
          if (!response.ok) throw new Error(`Navigation failed: ${response.status}`);
          next = (await response.json()) as PageRenderInput;
          if (next.pathname !== target.pathname || !next.dehydratedState)
            throw new Error("Invalid navigation response");
          // Keep the current page until the next one's blocks can render.
          await camoxApp.loadBlocks(getPageBlockTypes(next.dehydratedState));
        }
        if (!request.isCurrent()) return;
        const switching = (next.draftId ?? null) !== (current.current.draftId ?? null);
        // Back and forward already moved the browser's history.
        if (!pop) {
          if (replace || refresh) window.history.replaceState(null, "", target.url.href);
          else window.history.pushState(null, "", target.url.href);
        }
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
        React.startTransition(() =>
          setLocation((location) => ({
            input: next,
            source: pop ? undefined : source,
            generation: location.generation + (switching ? 1 : 0),
          })),
        );
        if (!pop && !replace && !refresh && !target.url.hash) window.scrollTo({ top: 0 });
      } catch {
        if (!request.isCurrent()) return;
        if (pop) window.location.reload();
        else if (replace) window.location.replace(target.url.href);
        else window.location.assign(target.url.href);
      }
    },
    [camoxApp, draftScope, initialInput.runtimeBasePath, queryClient, requests],
  );

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
      <React.Fragment key={generation}>{children(input)}</React.Fragment>
    </NavigationProvider>
  );
}
