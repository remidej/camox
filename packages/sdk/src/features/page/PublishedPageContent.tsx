import { queryKeys, type ReadSource } from "@camox/api-contract/query-keys";
import { useSuspenseQuery } from "@tanstack/react-query";

import { getApiClient } from "../../lib/api-client";
import { useProjectSlug } from "../../lib/auth";
import { NormalizedDataProvider, usePageBlocks } from "../../lib/normalized-data";
import { viewBlockQueries } from "../../lib/view-queries";
import { useLocation } from "../navigation/navigation";
import { BlockErrorBoundary } from "../preview/components/BlockErrorBoundary";
import { useCamoxApp } from "../provider/components/CamoxAppContext";
import { SharedLayoutContent } from "./SharedLayoutContent";

function pageStructureQueryFn(path: string, projectSlug: string, source: ReadSource) {
  return () => getApiClient().pages.getStructure({ path, projectSlug, source });
}

function PublishedBlock({
  blockId,
  mode,
  source,
}: {
  blockId: number;
  mode: "site" | "layout";
  source: ReadSource;
}) {
  const { data } = useSuspenseQuery(viewBlockQueries.get(blockId, source));
  const camoxApp = useCamoxApp();
  const blockDef = camoxApp.getBlockById(data.block.type);
  if (!blockDef) return null;

  return (
    <NormalizedDataProvider files={data.files} repeatableItems={data.repeatableItems}>
      <blockDef._internal.Component
        blockData={{
          _id: data.block.id,
          type: data.block.type,
          content: data.block.content as Record<string, unknown>,
          settings: data.block.settings as Record<string, unknown> | undefined,
          position: String(data.block.position),
        }}
        mode={mode}
        showAddBlockTop={false}
        showAddBlockBottom={false}
      />
    </NormalizedDataProvider>
  );
}

export function PublishedPageContent({ source }: { source: ReadSource }) {
  const { pathname } = useLocation();
  const projectSlug = useProjectSlug();
  const camoxApp = useCamoxApp();
  const { data: pageData } = useSuspenseQuery({
    queryKey: queryKeys.pages.getByPath(pathname, source),
    queryFn: pageStructureQueryFn(pathname, projectSlug, source),
    staleTime: Infinity,
  });
  const { pageBlocks, beforeBlocks, afterBlocks, layoutFiles, layoutItems } = usePageBlocks(
    pageData,
    source,
  );
  const layout = pageData.layout ? camoxApp.getLayoutById(pageData.layout.layoutId) : undefined;

  const pageBlocksContent = pageBlocks.map((block) => (
    <BlockErrorBoundary key={block.id} blockId={block.id} blockType={block.type}>
      <PublishedBlock blockId={block.id} mode="site" source={source} />
    </BlockErrorBoundary>
  ));

  if (!layout) {
    return <main className="flex min-h-screen flex-col">{pageBlocksContent}</main>;
  }

  return (
    <SharedLayoutContent
      layout={layout}
      blocks={[...beforeBlocks, ...afterBlocks]}
      files={layoutFiles}
      repeatableItems={layoutItems}
    >
      {pageBlocksContent}
    </SharedLayoutContent>
  );
}
