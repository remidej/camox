import type * as React from "react";

import { SelectionEditor } from "../../preview/components/SelectionEditor";
import { SidebarStackView } from "../../preview/components/SidebarStack";
import { usePreviewTargetSelection } from "../../preview/previewSelection";

/**
 * A Page's overview, which the selection editor replaces while something on the Page is
 * selected: a block, or a record page's record, which no block places. Every kind of Page
 * tracks its selection the same way.
 */
export function PageOverview({ children }: { children: React.ReactNode }) {
  const selection = usePreviewTargetSelection();
  return selection != null ? (
    <SelectionEditor pageCrumb={false} />
  ) : (
    <SidebarStackView depth={1} className="flex flex-col">
      {children}
    </SidebarStackView>
  );
}
