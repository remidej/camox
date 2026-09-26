import { useQuery } from "@tanstack/react-query";

import { useLocation } from "@/features/navigation/navigation";
import { matchCollectionContentPath } from "@/features/studio/routes";
import { useProjectSlug } from "@/lib/auth";
import { collectionQueries } from "@/lib/queries";

import { ContentSidebar } from "./components/ContentSidebar";
import { ContentAssets } from "./ContentAssets";
import { ContentCollection, ContentCollectionNew } from "./ContentCollection";

export const CamoxContent = () => {
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
  const pathname = useLocation({ select: (location) => location.pathname });
  const route = matchCollectionContentPath(pathname);
  const {
    data: collections = [],
    isError,
    isPending,
  } = useQuery(collectionQueries.list(projectSlug));
  const collection = collections.find((entry) => entry.collectionId === route?.collectionId);

  return (
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
      ) : route?.isNew && collection ? (
        <ContentCollectionNew
          key={collection.collectionId}
          projectSlug={projectSlug}
          collection={collection}
        />
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
  );
};
