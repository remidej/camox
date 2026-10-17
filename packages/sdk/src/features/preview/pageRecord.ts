import * as React from "react";

import type { AnyLayoutLoaderResult } from "@/core/createLayout";
import { useLatestRecord } from "@/core/editing/useLatestRecord";
import { asCollectionItem } from "@/core/recordItem";
import type { CollectionRecordId } from "@/core/requestContext";

import { useDraftScope } from "../../lib/draft-scope";
import { reads, useReadQuery } from "../../lib/studio-reads";
import { useLocation, useNavigate } from "../navigation/navigation";
import { useCamoxApp } from "../provider/components/CamoxAppContext";
import { fetchRuntimeJson } from "../runtime/navigationTarget";
import type { LayoutRecordPlacer } from "./components/useRecordView";

export type PageRecordId = CollectionRecordId;

/** The record a record page renders, as its loader's collection-item envelope names it. */
export function getPageRecord(result: AnyLayoutLoaderResult | undefined): PageRecordId | undefined {
  const record = asCollectionItem(result);
  if (!record) return undefined;
  return { collectionId: record.collectionId, id: record.data.id };
}

/**
 * The previewed code-owned page's loader result. The server rendered the page with `loaded`;
 * editing or publishing records loads it again.
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
  loaded: { result: AnyLayoutLoaderResult | undefined } | undefined;
}): AnyLayoutLoaderResult | undefined {
  // The server rendered the page with its result, which it filled in for the studio too.
  const { data } = useReadQuery(reads.derivedPageData({ projectSlug, runtimeBasePath, pathname }), {
    enabled: loaded != null,
  });
  // Until the read loads, the result the server rendered with stands in for it.
  if (data === undefined) return loaded?.result;
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
  const draftScope = useDraftScope();
  const { data: savedAt } = useReadQuery(
    reads.record({ projectSlug, collectionId: record?.collectionId ?? "", id: record?.id ?? "" }),
    { enabled: false, select: (saved) => saved.updatedAt },
  );
  const follow = React.useEffectEvent(async (signal: AbortSignal) => {
    if (!layoutId || !record) return;
    const response = await fetchRuntimeJson(
      draftScope,
      "/_camox/routes",
      runtimeBasePath,
      { layoutId, recordId: record.id },
      draftScope.current(),
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
    if (savedAt == null) return;
    const controller = new AbortController();
    // A failed lookup leaves the Studio where it is, as before the edit.
    follow(controller.signal).catch(() => {});
    return () => controller.abort();
  }, [savedAt]);
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
