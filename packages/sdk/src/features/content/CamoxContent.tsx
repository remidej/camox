import { useCallback } from "react";

import { Navigate, useNavigate } from "@/features/navigation/navigation";
import {
  collectionContentPath,
  matchCollectionContentPath,
  STUDIO_ASSETS_PATH,
  STUDIO_CONTENT_PATH,
} from "@/features/studio/routes";
import { useProjectUuid } from "@/lib/auth";
import { useLocalePath, useLocalizedPath } from "@/lib/view-locale";

import { reads, useReadQuery } from "../../lib/studio-reads";
import {
  CollectionItemSheetProvider,
  type CollectionItemSheetTarget,
} from "./CollectionItemSheetContext";
import { ContentSidebar } from "./components/ContentSidebar";
import { MissingFromLocaleGroup } from "./components/MissingFromLocale";
import { ContentAssets } from "./ContentAssets";
import { ContentCollection, ContentCollectionItemSheet } from "./ContentCollection";

export const CamoxContent = () => {
  const pathname = useLocalePath();
  const localized = useLocalizedPath();
  if (pathname === STUDIO_CONTENT_PATH || pathname === `${STUDIO_CONTENT_PATH}/`) {
    return <Navigate to={localized(STUDIO_ASSETS_PATH)} replace />;
  }

  if (
    typeof __CAMOX_ENABLE_EXPERIMENTAL_FEATURES__ !== "undefined" &&
    __CAMOX_ENABLE_EXPERIMENTAL_FEATURES__
  ) {
    return <ExperimentalContent />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-row">
      <ContentSidebar collections={[]} selectedCollectionId={null} collectionsError={false}>
        <MissingFromLocaleGroup collections={[]} />
      </ContentSidebar>
      <ContentAssets />
    </div>
  );
};

const ExperimentalContent = () => {
  const projectUuid = useProjectUuid();
  const navigate = useNavigate();
  const pathname = useLocalePath();
  const localized = useLocalizedPath();
  const route = matchCollectionContentPath(pathname);
  const {
    data: collections = [],
    isError,
    isPending,
  } = useReadQuery(reads.collectionList({ projectUuid }));
  const collection = collections.find((entry) => entry.collectionId === route?.collectionId);
  const routeTarget =
    route && (route.isNew || route.itemId)
      ? { collectionId: route.collectionId, itemId: route.itemId }
      : null;
  const closeRouteTarget = useCallback(
    (target: CollectionItemSheetTarget) => {
      void navigate({ to: localized(collectionContentPath(target.collectionId)), replace: true });
    },
    [localized, navigate],
  );

  return (
    <CollectionItemSheetProvider routeTarget={routeTarget} onRouteTargetClose={closeRouteTarget}>
      <div className="flex min-h-0 flex-1 flex-row">
        <ContentSidebar
          collections={collections}
          selectedCollectionId={route?.collectionId ?? null}
          collectionsError={isError}
        >
          <MissingFromLocaleGroup collections={collections} />
        </ContentSidebar>
        {route && !collection ? (
          <div role={isPending ? "status" : "alert"} className="text-muted-foreground p-6 text-sm">
            {isPending ? "Loading collection…" : "Collection not found."}
          </div>
        ) : collection ? (
          <ContentCollection
            key={collection.collectionId}
            projectUuid={projectUuid}
            collection={collection}
          />
        ) : (
          <ContentAssets />
        )}
      </div>
      <ContentCollectionItemSheet projectUuid={projectUuid} />
    </CollectionItemSheetProvider>
  );
};
