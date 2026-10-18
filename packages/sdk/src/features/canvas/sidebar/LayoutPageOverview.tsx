import { Alert, AlertDescription, AlertTitle } from "@camox/ui/alert";
import type * as React from "react";

import { useProjectSlug } from "../../../lib/auth";
import { reads, useRead } from "../../../lib/studio-reads";
import { LayoutPageBlocks } from "./LayoutPageBlocks";
import { PageOverview } from "./PageOverview";

/**
 * A layout page's overview: its layout's blocks, then a notice, which a singleton and a
 * derived page word for themselves.
 */
export function LayoutPageOverview({
  layoutId,
  notice,
}: {
  layoutId: string;
  notice: { title: string; description: React.ReactNode };
}) {
  const projectSlug = useProjectSlug();
  const layout = useRead(reads.layoutStructure({ projectSlug, layoutId }));
  return (
    <PageOverview>
      <div className="flex min-h-0 flex-1 flex-col overflow-auto">
        <div className="flex flex-col gap-4 px-2 pt-5">
          <LayoutPageBlocks layout={layout} />
          <Alert>
            <AlertTitle>{notice.title}</AlertTitle>
            <AlertDescription>{notice.description}</AlertDescription>
          </Alert>
        </div>
      </div>
    </PageOverview>
  );
}
