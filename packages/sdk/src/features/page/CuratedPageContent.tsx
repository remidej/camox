import { queryKeys } from "@camox/api-contract/query-keys";
import { useSuspenseQuery } from "@tanstack/react-query";
import * as React from "react";

import { getApiClient } from "../../lib/api-client";
import { useProjectSlug } from "../../lib/auth";
import { NormalizedDataProvider, usePageBlocks } from "../../lib/normalized-data";
import { viewBlockQueries } from "../../lib/view-queries";
import { useLocation } from "../navigation/navigation";
import { BlockErrorBoundary } from "../preview/components/BlockErrorBoundary";
import { useCamoxApp } from "../provider/components/CamoxAppContext";
import { SharedLayoutContent } from "./SharedLayoutContent";

function pageStructureQueryFn(path: string, projectSlug: string) {
  return () => getApiClient().pages.getStructure({ path, projectSlug });
}

function PageBlock({ blockId, mode }: { blockId: string; mode: "site" | "layout" }) {
  const { data } = useSuspenseQuery(viewBlockQueries.get(blockId));
  const camoxApp = useCamoxApp();
  // Hydration and navigation load a page's blocks first; this only waits for one they missed.
  const blockDef =
    camoxApp.getBlockById(data.block.type) ??
    (camoxApp.canLoadMoreBlocks() ? React.use(camoxApp.loadBlock(data.block.type)) : undefined);
  if (!blockDef) return null;

  return (
    <NormalizedDataProvider
      files={data.files}
      repeatableItems={data.repeatableItems}
      blocks={[data.block]}
    >
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

/** A curated page as visitors see it, without editing. */
export function CuratedPageContent() {
  const { pathname } = useLocation();
  const projectSlug = useProjectSlug();
  const camoxApp = useCamoxApp();
  const { data: pageData } = useSuspenseQuery({
    queryKey: queryKeys.pages.getByPath(pathname),
    queryFn: pageStructureQueryFn(pathname, projectSlug),
    staleTime: Infinity,
  });
  const { pageBlocks, beforeBlocks, afterBlocks, layoutFiles, layoutItems } =
    usePageBlocks(pageData);
  const layout = pageData.layout ? camoxApp.getLayoutById(pageData.layout.layoutId) : undefined;

  const pageBlocksContent = pageBlocks.map((block) => (
    <BlockErrorBoundary key={block.id} blockId={block.id} blockType={block.type}>
      <PageBlock blockId={block.id} mode="site" />
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
