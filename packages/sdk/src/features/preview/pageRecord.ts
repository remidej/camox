import { queryKeys, type ReadSource } from "@camox/api-contract/query-keys";
import { useQuery } from "@tanstack/react-query";
import { useSelector } from "@xstate/store-react";
import * as React from "react";

import type { AnyLayoutLoaderResult } from "@/core/createLayout";
import { useLatestRecord } from "@/core/editing/useLatestRecord";
import { asCollectionItem } from "@/core/recordItem";
import { collectionQueries } from "@/lib/queries";

import { useLocation, useNavigate } from "../navigation/navigation";
import { useCamoxApp } from "../provider/components/CamoxAppContext";
import { fetchRuntimeJson } from "../runtime/navigationTarget";
import type { PageRenderInput } from "../runtime/runtime";
import type { LayoutRecordPlacer } from "./components/useRecordView";
import { previewStore, selectPreviewSource } from "./previewStore";
import type { PageRecordId } from "./publication";

/**
 * A code-owned page's loader result in a preview source. Its records are draft or live content,
 * so it reloads with record edits and publication, like the draft reads it sits among.
 */
export function derivedPageQuery(
  projectSlug: string,
  runtimeBasePath: string,
  pathname: string,
  source: ReadSource,
) {
  return {
    queryKey: [
      ...queryKeys.layouts.all,
      "data",
      projectSlug,
      runtimeBasePath,
      pathname,
      source,
    ] as const,
    queryFn: async ({ signal }: { signal: AbortSignal }) => {
      const response = await fetchRuntimeJson(
        "/_camox/data",
        runtimeBasePath,
        { path: pathname, source },
        signal,
      );
      // A record without live content has no page for visitors.
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`Could not load ${pathname} (${response.status}).`);
      const input = (await response.json()) as PageRenderInput;
      return input.derived?.result ?? null;
    },
    staleTime: Infinity,
  };
}

/**
 * The previewed code-owned page's loader result, in the preview's source. The server rendered
 * the page with `loaded`; switching source, editing records or publishing loads it again.
 */
export function useDerivedPageResult({
  projectSlug,
  runtimeBasePath,
  pathname,
  loaded,
}: {
  projectSlug: string;
  runtimeBasePath: string;
  pathname: string;
  loaded: { result: AnyLayoutLoaderResult | undefined; source: ReadSource } | undefined;
}): AnyLayoutLoaderResult | undefined {
  const source = useSelector(previewStore, selectPreviewSource);
  const { data } = useQuery({
    ...derivedPageQuery(projectSlug, runtimeBasePath, pathname, source),
    enabled: loaded != null,
    initialData: loaded && loaded.source === source ? (loaded.result ?? null) : undefined,
  });
  return data ?? undefined;
}

/**
 * Keeps the Studio on the previewed record's page. Whenever a save through any placement
 * changes the record, the layout's route discovery finds its page again: editing the field the
 * page is found by (its slug) moves the Studio to the new URL rather than leaving it on a 404.
 */
export function useFollowPageRecord({
  projectSlug,
  runtimeBasePath,
  layoutId,
  record,
}: {
  projectSlug: string;
  runtimeBasePath: string;
  /** The derived layout rendering the page. */
  layoutId: string | undefined;
  record: PageRecordId | undefined;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const { data: savedVersion } = useQuery({
    ...collectionQueries.record(projectSlug, record?.collectionId ?? "", record?.id ?? ""),
    enabled: false,
    select: (saved) => saved.version,
  });
  const follow = React.useEffectEvent(async (signal: AbortSignal) => {
    if (!layoutId || !record) return;
    const response = await fetchRuntimeJson(
      "/_camox/routes",
      runtimeBasePath,
      { layoutId, recordId: record.id },
      signal,
    );
    if (!response.ok) return;
    const { path } = (await response.json()) as { path: string | null };
    if (!path || path === location.pathname || signal.aborted) return;
    // The Canvas keeps its camera on the frame, which now shows the same record.
    await navigate({
      to: `${path}${location.search}${location.hash}`,
      replace: true,
      source: "canvas",
    });
  });
  React.useEffect(() => {
    if (savedVersion == null) return;
    const controller = new AbortController();
    // A failed lookup leaves the Studio where it is, as before the edit.
    follow(controller.signal).catch(() => {});
    return () => controller.abort();
  }, [savedVersion]);
}

/** What the previewed record page's loader returned, for the Studio around its preview. */
export const PageRecordContext = React.createContext<AnyLayoutLoaderResult | undefined>(undefined);

/**
 * The record the previewed record page renders, as the sidebar edits it: as its loader returned
 * it, or as a later save stored it. Null on pages that render no record.
 */
export function usePageRecordPlacer(): LayoutRecordPlacer | null {
  const loaded = asCollectionItem(React.use(PageRecordContext));
  const app = useCamoxApp();
  const collection = loaded ? app.getCollectionById(loaded.collectionId) : undefined;
  const collectionId = loaded?.collectionId ?? "";
  const record = useLatestRecord({
    collectionId,
    labelField: collection?._internal.label ?? "",
    loaded: collection ? loaded?.data : undefined,
  });
  return React.useMemo(() => (record ? { collectionId, record } : null), [collectionId, record]);
}
