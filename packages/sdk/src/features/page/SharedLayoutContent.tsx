import * as React from "react";

import type { Layout, LayoutBlockData, AnyLayoutLoaderResult } from "../../core/createLayout";
import type { AnyLayoutContext } from "../../core/layoutContext";
import {
  NormalizedDataProvider,
  type NormalizedBlock,
  type NormalizedFile,
  type NormalizedItem,
} from "../../lib/normalized-data";

/** Shared before/after rendering for both curated and data-derived pages. */
export function SharedLayoutContent({
  layout,
  context,
  blocks,
  files,
  repeatableItems,
  result,
  children,
}: {
  layout: Layout;
  /** The page's context, which the layout's `toReact` receives as props. */
  context: AnyLayoutContext;
  blocks: NormalizedBlock[];
  files: NormalizedFile[];
  repeatableItems: NormalizedItem[];
  result?: AnyLayoutLoaderResult;
  children?: React.ReactNode;
}) {
  const layoutBlocks = React.useMemo(() => {
    const result: Record<string, LayoutBlockData> = {};
    for (const block of blocks) {
      result[block.type] = {
        _id: block.id,
        type: block.type,
        content: block.content as Record<string, unknown>,
        settings: block.settings as Record<string, unknown> | undefined,
        position: String(block.position),
      };
    }
    return result;
  }, [blocks]);
  const ToReact = layout._internal.toReact;
  return (
    <NormalizedDataProvider files={files} repeatableItems={repeatableItems} blocks={blocks}>
      <layout._internal.Provider layoutBlocks={layoutBlocks} result={result}>
        <ToReact {...context}>{children}</ToReact>
      </layout._internal.Provider>
    </NormalizedDataProvider>
  );
}
