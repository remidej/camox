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
  referenceTargets?: ReferencePublicationTarget[];
  missingRequired?: string[];
};

export type ReferencePublicationTarget = {
  id: string;
  collectionId: string;
  label: string;
  expectedVersion: number;
  status: "draft" | "modified" | "published";
  required: boolean;
  hasPublishedRevision: boolean;
};

export function referencePublicationKey(target: ReferencePublicationTarget) {
  return `collection:${target.collectionId}:${target.id}`;
}

/** Keep the reviewed versions, not versions from background cache refreshes. */
export function withReferenceTargets(
  plan: PublicationPlan,
  targets: readonly ReferencePublicationTarget[],
  missingRequired: string[] = [],
): PublicationPlan {
  const unique = new Map<string, ReferencePublicationTarget>();
  for (const target of targets) {
    const key = referencePublicationKey(target);
    const previous = unique.get(key);
    unique.set(key, { ...target, required: target.required || !!previous?.required });
  }
  const referenceTargets = [...unique.values()];
  return {
    ...plan,
    referenceTargets,
    missingRequired,
    items: [
      ...plan.items,
      ...referenceTargets
        .filter((target) => target.status !== "published")
        .map((target) => ({
          key: referencePublicationKey(target),
          label: target.label,
          optional: true,
          impact: target.hasPublishedRevision
            ? "Updates this item wherever it is used. If excluded, its previous published revision stays live."
            : target.required
              ? "This required item has never been published. Include it to publish this content."
              : "Publishes this item wherever it is used. If excluded, this reference stays empty.",
        })),
    ],
  };
}

export function getPublicationBlocker(plan: PublicationPlan, includedKeys: readonly string[]) {
  if (plan.missingRequired?.length) {
    return `Choose an item for required references before publishing: ${plan.missingRequired.join(", ")}.`;
  }
  const missing = plan.referenceTargets?.filter(
    (target) =>
      target.required &&
      !target.hasPublishedRevision &&
      !includedKeys.includes(referencePublicationKey(target)),
  );
  if (!missing?.length) return undefined;
  return `Include required unpublished items before publishing: ${missing.map((target) => target.label).join(", ")}.`;
}

/** Scope and impact are shared by all publishing entry points. Reference targets
 * are added from the backend's scoped plan; they publish in the same request,
 * never a sequence of independent record requests.
 */
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
  | {
      kind: "page";
      input: { id: number; alsoPublishLayout?: true; collections?: CollectionPublicationInput[] };
    }
  | { kind: "layout"; input: { id: number; collections?: CollectionPublicationInput[] } };

type CollectionPublicationInput = Pick<
  ReferencePublicationTarget,
  "id" | "collectionId" | "expectedVersion"
>;

export function getPublicationRequest(
  target: PublicationTarget,
  includedKeys: readonly string[],
  plan: PublicationPlan = buildPublicationPlan(target),
): PublicationRequest {
  const blocker = getPublicationBlocker(plan, includedKeys);
  if (blocker) throw new Error(blocker);
  const collections = plan.referenceTargets
    ?.filter(
      (item) => item.status !== "published" && includedKeys.includes(referencePublicationKey(item)),
    )
    .map(({ id, collectionId, expectedVersion }) => ({ id, collectionId, expectedVersion }));
  const collectionInput = collections?.length ? { collections } : {};
  if (target.kind === "layout")
    return { kind: "layout", input: { id: target.layout.id, ...collectionInput } };
  const optionalLayout = plan.items.find((item) => item.optional && item.key.startsWith("layout:"));
  const alsoPublishLayout = optionalLayout && includedKeys.includes(optionalLayout.key);
  return {
    kind: "page",
    input: {
      id: target.page.id,
      ...(alsoPublishLayout ? { alsoPublishLayout: true as const } : {}),
      ...collectionInput,
    },
  };
}
