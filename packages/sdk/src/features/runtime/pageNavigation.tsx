import { DRAFT_SEARCH_PARAM } from "@camox/api-contract/drafts";
import { LIVE_KEY_SCOPE, scopeOfKey } from "@camox/api-contract/query-keys";
import { hydrate, type QueryClient } from "@tanstack/react-query";
import { createHead, renderDOMHead } from "@unhead/react/client";
import * as React from "react";
import type { ActiveHeadEntry, UseHeadInput } from "unhead/types";

import type { CamoxApp } from "../../core/createApp";
import {
  getCurrentDraftId,
  onDraftStarted,
  readDraftFromUrl,
  reportDraftNotice,
} from "../../lib/studio-draft";
import { withDraftParam } from "../navigation/draftParam";
import { NavigationProvider, type NavigateOptions } from "../navigation/navigation";
import { createNavigationRequestTracker } from "./navigationRequest";
import { getNavigationTarget, runtimePath } from "./navigationTarget";
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

const draftOf = (href: string) => new URL(href).searchParams.get(DRAFT_SEARCH_PARAM);

/**
 * Removes the draft param from the browser's URL, in place, when the page couldn't show that
 * draft and showed Live instead (ADR 0011).
 */
function dropRefusedDraft(input: PageRenderInput) {
  if (!input.refusedDraft) return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has(DRAFT_SEARCH_PARAM)) return;
  url.searchParams.delete(DRAFT_SEARCH_PARAM);
  window.history.replaceState(window.history.state, "", url.href);
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
  // Provenance belongs to the committed location, not the payload or browser history. Each
  // switch to another draft starts a new generation, which mounts the page afresh so every query
  // reads that draft's keys.
  const [{ input, source, generation }, setLocation] = React.useState<{
    input: PageRenderInput;
    source?: NavigateOptions["source"];
    generation: number;
  }>(() => {
    // Before anything reads the draft from the URL, drop one the server couldn't show.
    if (typeof window !== "undefined") {
      dropRefusedDraft(initialInput);
      readDraftFromUrl();
    }
    return { input: initialInput, generation: 0 };
  });
  const current = React.useRef(initialInput);
  const [requests] = React.useState(createNavigationRequestTracker);
  const headManager = React.useRef<{
    head: ReturnType<typeof createHead>;
    entry?: ActiveHeadEntry<UseHeadInput>;
  } | null>(null);

  React.useEffect(() => {
    const notice = initialInput.refusedDraft?.notice;
    if (notice) reportDraftNotice(notice);
  }, [initialInput]);

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
        draftId: getCurrentDraftId() ?? undefined,
      };
      current.current = next;
      setLocation((location) => ({ ...location, input: next }));
    };
    adoptBrowserUrl();
    return onDraftStarted(adoptBrowserUrl);
  }, []);

  const navigate = React.useCallback(
    async ({ to, replace, source, draft, pop = false }: NavigateOptions & { pop?: boolean }) => {
      const request = requests.begin();
      // Every navigation keeps the URL's draft unless it switches drafts. History traversal
      // already restored the URL it goes to.
      const href = pop ? to : withDraftParam(to, window.location.href, draft);
      const target = getNavigationTarget(href, window.location.href, initialInput.runtimeBasePath);
      if (!target) {
        if (replace) window.location.replace(to);
        else window.location.assign(to);
        return;
      }

      // Selecting the current page is still a navigation intent: begin() above
      // cancels an in-flight selection, but must not add a duplicate history entry.
      if (!pop && target.url.href === current.current.href) return;

      try {
        let next = current.current;
        const targetDraft = target.url.searchParams.get(DRAFT_SEARCH_PARAM);
        // Hash/search-only changes need no new route payload, unless they switch drafts.
        if (target.pathname !== next.pathname || pop || targetDraft !== draftOf(next.href)) {
          const url = new URL(
            runtimePath("/_camox/data", initialInput.runtimeBasePath),
            window.location.origin,
          );
          url.searchParams.set("path", target.pathname);
          if (targetDraft) url.searchParams.set(DRAFT_SEARCH_PARAM, targetDraft);
          const response = await fetch(url, {
            credentials: "same-origin",
            headers: { Accept: "application/json" },
            signal: request.signal,
          });
          if (!response.ok) throw new Error(`Navigation failed: ${response.status}`);
          next = (await response.json()) as PageRenderInput;
          if (next.pathname !== target.pathname || !next.dehydratedState)
            throw new Error("Invalid navigation response");
          // Keep the current page until the next one's blocks can render.
          await camoxApp.loadBlocks(getPageBlockTypes(next.dehydratedState));
        }
        if (!request.isCurrent()) return;
        // The page couldn't show the draft, so it showed Live: the URL drops the draft too.
        if (next.refusedDraft) target.url.searchParams.delete(DRAFT_SEARCH_PARAM);
        const previousDraft = getCurrentDraftId();
        const nextDraft = next.draftId ?? null;
        const switching = nextDraft !== previousDraft;
        if (switching) {
          // Queries cached the last time this draft was shown may be outdated by now.
          const entered = nextDraft ?? LIVE_KEY_SCOPE;
          void queryClient.invalidateQueries({
            predicate: (query) => scopeOfKey(query.queryKey) === entered,
            refetchType: "none",
          });
        }
        hydrate(
          queryClient,
          switching
            ? next.dehydratedState
            : preserveStableLayoutBlockCaches(
                next.dehydratedState,
                current.current.layoutIdentity,
                next.layoutIdentity,
              ),
        );
        next = { ...next, href: target.url.href };
        current.current = next;

        if (pop && next.refusedDraft) {
          window.history.replaceState(null, "", target.url.href);
        } else if (!pop) {
          if (replace) window.history.replaceState(null, "", target.url.href);
          else window.history.pushState(null, "", target.url.href);
        }
        readDraftFromUrl();
        if (next.refusedDraft?.notice) reportDraftNotice(next.refusedDraft.notice);
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
        if (!pop && !replace && !target.url.hash) window.scrollTo({ top: 0 });
      } catch {
        if (!request.isCurrent()) return;
        if (pop) window.location.reload();
        else if (replace) window.location.replace(target.url.href);
        else window.location.assign(target.url.href);
      }
    },
    [camoxApp, initialInput.runtimeBasePath, queryClient, requests],
  );

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
