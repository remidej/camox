import * as React from "react";

import type { Layout, LayoutBlockData } from "../../core/createLayout";
import {
  NormalizedDataProvider,
  type NormalizedBlock,
  type NormalizedFile,
  type NormalizedItem,
} from "../../lib/normalized-data";

/** Shared before/after rendering for both curated and data-derived pages. */
export function SharedLayoutContent({
  layout,
  blocks,
  files,
  repeatableItems,
  data,
  children,
}: {
  layout: Layout;
  blocks: NormalizedBlock[];
  files: NormalizedFile[];
  repeatableItems: NormalizedItem[];
  data?: unknown;
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
  const Component = layout._internal.component;
  return (
    <NormalizedDataProvider files={files} repeatableItems={repeatableItems}>
      <layout._internal.Provider layoutBlocks={layoutBlocks} data={data}>
        <Component>{children}</Component>
      </layout._internal.Provider>
    </NormalizedDataProvider>
  );
}
