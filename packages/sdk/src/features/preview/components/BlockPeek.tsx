import * as React from "react";

import type { Block } from "@/core/createBlock";
import { NormalizedDataProvider } from "@/lib/normalized-data";

/**
 * A block rendered by its code from its peek bundle: what its thumbnail shows. It catches no
 * error: a broken block shows no thumbnail, which is for the thumbnail to do.
 */
export const BlockPeek = ({ block }: { block: Block }) => {
  const bundle = React.useMemo(() => block._internal.getPeekBundle(), [block]);
  return (
    <React.Suspense fallback={null}>
      <NormalizedDataProvider files={bundle.files} repeatableItems={bundle.repeatableItems}>
        <block._internal.Component
          blockData={{
            _id: "thumbnail",
            type: block._internal.id,
            content: bundle.block.content as Record<string, unknown>,
            settings: bundle.block.settings as Record<string, unknown> | undefined,
            position: "",
          }}
          mode="peek"
        />
      </NormalizedDataProvider>
    </React.Suspense>
  );
};
