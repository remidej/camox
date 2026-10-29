import { reads, useRead } from "../../lib/studio-reads";
import { BlockErrorBoundary } from "../preview/components/BlockErrorBoundary";
import { PageBlock } from "./CuratedPageContent";

/**
 * A block placed nowhere, alone, as a page would show it: the look document's Block Definition
 * mode (ADR 0032). Its bundle is read like a page's block, so it renders and hydrates as one.
 * Thumbnails render a Block Definition their own way (`BlockPeek`); only the block render is
 * shared.
 */
export function UnplacedBlockContent({ blockId }: { blockId: string }) {
  const { block } = useRead(reads.blockBundle(blockId));
  return (
    <main className="flex flex-col">
      <BlockErrorBoundary blockId={blockId} blockType={block.type}>
        <PageBlock blockId={blockId} mode="site" />
      </BlockErrorBoundary>
    </main>
  );
}
