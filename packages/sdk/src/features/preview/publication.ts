import { queryKeys } from "@camox/api-contract/query-keys";
import type { QueryClient } from "@tanstack/react-query";

import type { AnyLayoutLoaderResult } from "@/core/createLayout";
import { asCollectionItem } from "@/core/recordItem";
import type { CollectionRecordId } from "@/core/requestContext";
import type { Layout } from "@/lib/queries";

import type { PreviewedPage } from "./components/PageNavigatorSidebar";

export type PublicationTarget =
  | {
      kind: "page";
      page: Pick<
        PreviewedPage,
        "id" | "fullPath" | "status" | "livePublishedCheckpointId" | "modifiedReason"
      >;
    }
  | {
      kind: "layout";
      layout: Pick<Layout, "id" | "status" | "livePublishedCheckpointId"> &
        Partial<Pick<Layout, "kind">>;
      name: string;
    };

export type PageRecordId = CollectionRecordId;

/**
 * Refreshes what a publication may change: other pages, layout blocks, records, and code-owned
 * pages' loaded data. Doesn't rely only on the realtime broadcast to refresh the initiating
 * client's view.
 */
export async function refreshPublishedViews(queryClient: QueryClient) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.layouts.all }),
    queryClient.invalidateQueries({ queryKey: queryKeys.pages.list }),
    queryClient.invalidateQueries({ queryKey: queryKeys.pages.getByPathAll }),
    queryClient.invalidateQueries({ queryKey: ["camox", "pages", "getById"] }),
    queryClient.invalidateQueries({ queryKey: ["camox", "blocks", "get"] }),
    queryClient.invalidateQueries({ queryKey: ["camox", "collections"] }),
  ]);
}

/** The record a record page renders, as its loader's collection-item envelope names it. */
export function getPageRecord(result: AnyLayoutLoaderResult | undefined): PageRecordId | undefined {
  const record = asCollectionItem(result);
  if (!record) return undefined;
  return { collectionId: record.collectionId, id: record.data.id };
}

export type PublicationItem = {
  key: string;
  label: string;
  switchLabel?: string;
  impact: string;
  optional: boolean;
};

export type PublicationPlan = {
  title: string;
  description: string;
  items: PublicationItem[];
};

/** Scope and impact are shared by all publishing entry points. */
export function buildPublicationPlan(target: PublicationTarget): PublicationPlan {
  if (target.kind === "layout" && target.layout.kind === "singleton") {
    return {
      title: "Publish page content",
      description: `Publishes the editable blocks on ${target.name}. The route and application data are controlled by code, not publishing.`,
      items: [
        {
          key: `layout:${target.layout.id}`,
          label: `${target.name} blocks`,
          impact:
            "Updates this page’s before and after blocks. Synced block changes also apply wherever those blocks are used.",
          optional: false,
        },
      ],
    };
  }
  if (target.kind === "layout") {
    return {
      title: target.layout.status === "modified" ? "Publish changes" : "Publish layout",
      description: `Publishes ${target.name} on every page using this layout. Generated content and external data are not published by this action.`,
      items: [
        {
          key: `layout:${target.layout.id}`,
          label: `${target.name} layout blocks`,
          // affectedPagesCount only counts stored curated pages, not derived URLs.
          impact:
            "Updates the before and after blocks on every page using this layout, including all derived URLs.",
          optional: false,
        },
      ],
    };
  }

  const { page } = target;
  const items: PublicationItem[] = [
    {
      key: `page:${page.id}`,
      label: page.fullPath,
      impact:
        page.status === "draft"
          ? "Makes this page live with its current draft content."
          : "Updates this page with its latest draft content.",
      optional: false,
    },
  ];
  const reason = page.modifiedReason;
  if (reason && (reason.reason === "layout" || reason.reason === "both")) {
    const others = Math.max(0, reason.affectedPagesCount - 1);
    items.push({
      key: `layout:${reason.layoutId}`,
      label: `${reason.layoutHandle} layout blocks`,
      impact:
        others === 0
          ? "Updates layout blocks on this page. Affects no other pages."
          : `Updates layout blocks on this page and ${others} other ${others === 1 ? "page" : "pages"}.`,
      optional: true,
    });
  }
  return {
    title: page.status === "modified" ? "Publish changes" : "Publish page",
    description:
      page.status === "draft"
        ? `This page will go live at ${page.fullPath}.`
        : `Visitors at ${page.fullPath} will see your latest changes.`,
    items,
  };
}

export function getPublicationCapabilities(
  target: PublicationTarget | null,
  source: "draft" | "live",
) {
  if (!target) return { publish: false, unpublish: false, discard: false };
  const record = target.kind === "page" ? target.page : target.layout;
  return {
    publish: record.status !== "published" && source === "draft",
    unpublish:
      record.livePublishedCheckpointId != null &&
      !(target.kind === "page" && target.page.fullPath === "/"),
    discard: target.kind === "page" && record.status === "modified",
  };
}

export type PublicationRequest =
  | { kind: "page"; input: { id: number; alsoPublishLayout?: true } }
  | { kind: "layout"; input: { id: number } };

export function getPublicationRequest(
  target: PublicationTarget,
  includedKeys: readonly string[],
  plan: PublicationPlan = buildPublicationPlan(target),
): PublicationRequest {
  const optionalLayout = plan.items.find((item) => item.optional && item.key.startsWith("layout:"));
  const alsoPublishLayout = optionalLayout && includedKeys.includes(optionalLayout.key);
  if (target.kind === "layout") return { kind: "layout", input: { id: target.layout.id } };
  return {
    kind: "page",
    input: {
      id: target.page.id,
      ...(alsoPublishLayout ? { alsoPublishLayout: true as const } : {}),
    },
  };
}
