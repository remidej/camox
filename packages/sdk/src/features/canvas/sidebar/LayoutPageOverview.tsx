import { Alert, AlertDescription, AlertTitle } from "@camox/ui/alert";
import type * as React from "react";

import { useProjectUuid } from "../../../lib/auth";
import { reads, useRead } from "../../../lib/studio-reads";
import { LayoutPageBlocks } from "./LayoutPageBlocks";
import { LayoutPageSeo, type LayoutPageTarget } from "./LayoutPageSeo";
import { PageOverview } from "./PageOverview";

/**
 * A layout page's overview: its layout's blocks, then a notice, which a singleton and a
 * derived page word for themselves, then its SEO and Markdown, which its code builds.
 */
export function LayoutPageOverview({
  layoutId,
  notice,
  target,
}: {
  layoutId: string;
  notice: { title: string; description: React.ReactNode };
  target: LayoutPageTarget;
}) {
  const projectUuid = useProjectUuid();
  const layout = useRead(reads.layoutStructure({ projectUuid, layoutId }));
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
        <div className="space-y-4 p-2 pt-4">
          <LayoutPageSeo target={target} />
        </div>
      </div>
    </PageOverview>
  );
}
