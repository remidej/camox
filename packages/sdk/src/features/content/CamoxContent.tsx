import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";

import { Navigate, useLocation, useNavigate } from "@/features/navigation/navigation";
import {
  collectionContentPath,
  matchCollectionContentPath,
  STUDIO_ASSETS_PATH,
  STUDIO_CONTENT_PATH,
} from "@/features/studio/routes";
import { useProjectSlug } from "@/lib/auth";
import { collectionQueries } from "@/lib/queries";

import {
  CollectionItemModalProvider,
  type CollectionItemModalTarget,
} from "./CollectionItemModalContext";
import { ContentSidebar } from "./components/ContentSidebar";
import { ContentAssets } from "./ContentAssets";
import { ContentCollection, ContentCollectionItemModal } from "./ContentCollection";

export const CamoxContent = () => {
  const pathname = useLocation({ select: (location) => location.pathname });
  if (pathname === STUDIO_CONTENT_PATH || pathname === `${STUDIO_CONTENT_PATH}/`) {
    return <Navigate to={STUDIO_ASSETS_PATH} replace />;
  }

  if (
    typeof __CAMOX_ENABLE_EXPERIMENTAL_FEATURES__ !== "undefined" &&
    __CAMOX_ENABLE_EXPERIMENTAL_FEATURES__
  ) {
    return <ExperimentalContent />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-row">
      <ContentSidebar collections={[]} selectedCollectionId={null} collectionsError={false} />
      <ContentAssets />
    </div>
  );
};

const ExperimentalContent = () => {
  const projectSlug = useProjectSlug();
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const route = matchCollectionContentPath(pathname);
  const {
    data: collections = [],
    isError,
    isPending,
  } = useQuery(collectionQueries.list(projectSlug));
  const collection = collections.find((entry) => entry.collectionId === route?.collectionId);
  const routeTarget =
    route && (route.isNew || route.itemId)
      ? { collectionId: route.collectionId, itemId: route.itemId }
      : null;
  const closeRouteTarget = useCallback(
    (target: CollectionItemModalTarget) => {
      void navigate({ to: collectionContentPath(target.collectionId), replace: true });
    },
    [navigate],
  );

  return (
    <CollectionItemModalProvider routeTarget={routeTarget} onRouteTargetClose={closeRouteTarget}>
      <div className="flex min-h-0 flex-1 flex-row">
        <ContentSidebar
          collections={collections}
          selectedCollectionId={route?.collectionId ?? null}
          collectionsError={isError}
        />
        {route && !collection ? (
          <div role={isPending ? "status" : "alert"} className="text-muted-foreground p-6 text-sm">
            {isPending ? "Loading collection…" : "Collection not found."}
          </div>
        ) : collection ? (
          <ContentCollection
            key={collection.collectionId}
            projectSlug={projectSlug}
            collection={collection}
          />
        ) : (
          <ContentAssets />
        )}
      </div>
      <ContentCollectionItemModal projectSlug={projectSlug} />
    </CollectionItemModalProvider>
  );
};
