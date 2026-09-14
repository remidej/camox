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
      layout: Pick<Layout, "id" | "status" | "livePublishedCheckpointId">;
      name: string;
    };

export type PublicationItem = {
  key: string;
  label: string;
  impact: string;
  optional: boolean;
};

export type PublicationPlan = {
  title: string;
  description: string;
  items: PublicationItem[];
};

/** Scope and impact are shared by all publishing entry points. Only expose choices
 * the backend can execute: a page and its optional layout, or a whole layout.
 * Synced-block dependencies will need backend planning/execution support here,
 * not a separate publishing UI or a sequence of independent block requests.
 */
export function buildPublicationPlan(target: PublicationTarget): PublicationPlan {
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
          ? "Updates shared blocks on this page. Affects no other pages."
          : `Updates shared blocks on this page and ${others} other ${others === 1 ? "page" : "pages"}.`,
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
): PublicationRequest {
  if (target.kind === "layout") return { kind: "layout", input: { id: target.layout.id } };
  const optionalLayout = buildPublicationPlan(target).items.find((item) => item.optional);
  const alsoPublishLayout = optionalLayout && includedKeys.includes(optionalLayout.key);
  return {
    kind: "page",
    input: {
      id: target.page.id,
      ...(alsoPublishLayout ? { alsoPublishLayout: true as const } : {}),
    },
  };
}
