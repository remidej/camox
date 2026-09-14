import { hydrate, type QueryClient } from "@tanstack/react-query";
import { createHead, renderDOMHead } from "@unhead/react/client";
import * as React from "react";
import type { ActiveHeadEntry, UseHeadInput } from "unhead/types";

import { NavigationProvider } from "../navigation/navigation";
import { createNavigationRequestTracker } from "./navigationRequest";
import { getNavigationTarget, runtimePath } from "./navigationTarget";
import { createPageHeadInput, type LayoutIdentity, type PageRenderInput } from "./runtime";

function preserveStableLayoutBlockCaches(
  dehydratedState: unknown,
  current: LayoutIdentity | null,
  next: LayoutIdentity | null,
) {
  if (
    !current ||
    !next ||
    current.id !== next.id ||
    current.layoutId !== next.layoutId ||
    current.version !== next.version
  )
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
        typeof key[3] === "number" &&
        ids.has(key[3])
      );
    }),
  };
}

export function PageNavigationProvider({
  children,
  initialInput,
  queryClient,
}: {
  children: (input: PageRenderInput) => React.ReactNode;
  initialInput: PageRenderInput;
  queryClient: QueryClient;
}) {
  const [input, setInput] = React.useState(initialInput);
  const current = React.useRef(initialInput);
  const [requests] = React.useState(createNavigationRequestTracker);
  const headManager = React.useRef<{
    head: ReturnType<typeof createHead>;
    entry?: ActiveHeadEntry<UseHeadInput>;
  } | null>(null);

  const navigate = React.useCallback(
    async ({ to, replace, pop = false }: { to: string; replace?: boolean; pop?: boolean }) => {
      const request = requests.begin();
      const target = getNavigationTarget(to, window.location.href, initialInput.runtimeBasePath);
      if (!target) {
        if (replace) window.location.replace(to);
        else window.location.assign(to);
        return;
      }

      try {
        let next = current.current;
        // Hash/search-only changes need no new route payload.
        if (target.pathname !== next.pathname || pop) {
          const url = new URL(
            runtimePath("/_camox/data", initialInput.runtimeBasePath),
            window.location.origin,
          );
          url.searchParams.set("path", target.pathname);
          const response = await fetch(url, {
            credentials: "same-origin",
            headers: { Accept: "application/json" },
            signal: request.signal,
          });
          if (!response.ok) throw new Error(`Navigation failed: ${response.status}`);
          next = (await response.json()) as PageRenderInput;
          if (next.pathname !== target.pathname || !next.dehydratedState)
            throw new Error("Invalid navigation response");
        }
        if (!request.isCurrent()) return;
        hydrate(
          queryClient,
          preserveStableLayoutBlockCaches(
            next.dehydratedState,
            current.current.layoutIdentity,
            next.layoutIdentity,
          ),
        );
        next = { ...next, href: target.url.href };
        current.current = next;

        if (!pop) {
          if (replace) window.history.replaceState(null, "", target.url.href);
          else window.history.pushState(null, "", target.url.href);
        }
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
        React.startTransition(() => setInput(next));
        if (!pop && !replace && !target.url.hash) window.scrollTo({ top: 0 });
      } catch {
        if (!request.isCurrent()) return;
        if (pop) window.location.reload();
        else if (replace) window.location.replace(target.url.href);
        else window.location.assign(target.url.href);
      }
    },
    [initialInput.runtimeBasePath, queryClient, requests],
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
      location={{ href: input.href, pathname: input.pathname, hash: url.hash, search: url.search }}
      navigate={navigate}
    >
      {children(input)}
    </NavigationProvider>
  );
}
