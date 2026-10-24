import * as React from "react";

import { curatedLayoutContext } from "@/core/layoutContext";
import { NormalizedDataProvider, usePageBlocks } from "@/lib/normalized-data";
import { useViewLocale } from "@/lib/view-locale-context";

import { reads, useRead } from "../../lib/studio-reads";
import { useCamoxApp } from "../provider/components/CamoxAppContext";
import { usePreviewedPage } from "./CamoxPreview";
import { BlockErrorBoundary } from "./components/BlockErrorBoundary";
import { RemovedBlockPlaceholder } from "./components/RemovedBlockPlaceholder";

/*
 * The page a frame edits, rendered by the site's code. Only the renderer frame renders it: the
 * studio runs none of the site's code.
 */

/* -------------------------------------------------------------------------------------------------
 * BlockRenderer — subscribes to individual block cache for granular re-renders
 * -----------------------------------------------------------------------------------------------*/

const BlockRenderer = ({
  blockId,
  mode,
  showAddBlockTop,
  showAddBlockBottom,
}: {
  blockId: string;
  mode: "site" | "peek" | "layout";
  showAddBlockTop: boolean;
  showAddBlockBottom: boolean;
}) => {
  const data = useRead(reads.blockBundle(blockId));
  const camoxApp = useCamoxApp();
  const blockDef = camoxApp.getBlockById(data.block.type);

  if (!blockDef) {
    return <RemovedBlockPlaceholder blockId={blockId} type={data.block.type} mode={mode} />;
  }

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
        showAddBlockTop={showAddBlockTop}
        showAddBlockBottom={showAddBlockBottom}
      />
    </NormalizedDataProvider>
  );
};

/* -------------------------------------------------------------------------------------------------
 * PageContent
 * -----------------------------------------------------------------------------------------------*/

export const EditablePageContent = () => {
  const pageData = usePreviewedPage();
  const { pageBlocks, beforeBlocks, afterBlocks, layoutFiles, layoutItems } =
    usePageBlocks(pageData);

  const camoxApp = useCamoxApp();
  const { locale } = useViewLocale();

  // Look up layout
  const layout = pageData.layout ? camoxApp.getLayoutById(pageData.layout.layoutId) : undefined;

  // Build layout block data map by type
  const layoutBlocksMap = React.useMemo(() => {
    if (!pageData.layout) return null;
    const allLayoutBlocks = [...beforeBlocks, ...afterBlocks];
    const blocks: Record<
      string,
      {
        _id: string;
        type: string;
        content: Record<string, unknown>;
        settings?: Record<string, unknown>;
        position: string;
      }
    > = {};
    for (const block of allLayoutBlocks) {
      blocks[block.type] = {
        _id: block.id,
        type: block.type,
        content: block.content as Record<string, unknown>,
        settings: block.settings as Record<string, unknown> | undefined,
        position: String(block.position),
      };
    }
    return blocks;
  }, [pageData.layout, beforeBlocks, afterBlocks]);

  const pageBlocksContent = (
    <>
      {pageBlocks.map((blockData, index) => (
        <BlockErrorBoundary key={blockData.id} blockId={blockData.id} blockType={blockData.type}>
          <BlockRenderer
            blockId={blockData.id}
            mode="site"
            showAddBlockTop={
              index === 0
                ? (layout?._internal.blockDefinitions.some((b) => b.slot === "before") ?? false)
                : true
            }
            showAddBlockBottom={true}
          />
        </BlockErrorBoundary>
      ))}
    </>
  );

  if (layout && layoutBlocksMap) {
    const ToReact = layout._internal.toReact;
    return (
      <NormalizedDataProvider
        files={layoutFiles}
        repeatableItems={layoutItems}
        blocks={[...beforeBlocks, ...afterBlocks]}
      >
        <layout._internal.Provider layoutBlocks={layoutBlocksMap}>
          <ToReact {...curatedLayoutContext(pageData, locale)}>{pageBlocksContent}</ToReact>
        </layout._internal.Provider>
      </NormalizedDataProvider>
    );
  }

  return <main className="flex min-h-screen flex-col">{pageBlocksContent}</main>;
};
