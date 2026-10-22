import * as React from "react";

import { curatedLayoutContext } from "../../core/layoutContext";
import { useProjectUuid } from "../../lib/auth";
import { NormalizedDataProvider, usePageBlocks } from "../../lib/normalized-data";
import { reads, useRead } from "../../lib/studio-reads";
import { useLocalePath } from "../../lib/view-locale";
import { useViewLocale } from "../../lib/view-locale-context";
import { BlockErrorBoundary } from "../preview/components/BlockErrorBoundary";
import { useCamoxApp } from "../provider/components/CamoxAppContext";
import { SharedLayoutContent } from "./SharedLayoutContent";

function PageBlock({ blockId, mode }: { blockId: string; mode: "site" | "layout" }) {
  const data = useRead(reads.blockBundle(blockId));
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
  const pathname = useLocalePath();
  const projectUuid = useProjectUuid();
  const camoxApp = useCamoxApp();
  const pageData = useRead(reads.pageStructure({ path: pathname, projectUuid }));
  const { pageBlocks, beforeBlocks, afterBlocks, layoutFiles, layoutItems } =
    usePageBlocks(pageData);
  const layout = pageData.layout ? camoxApp.getLayoutById(pageData.layout.layoutId) : undefined;
  const { locale } = useViewLocale();
  const context = curatedLayoutContext(pageData, locale);

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
      context={context}
      blocks={[...beforeBlocks, ...afterBlocks]}
      files={layoutFiles}
      repeatableItems={layoutItems}
    >
      {pageBlocksContent}
    </SharedLayoutContent>
  );
}
