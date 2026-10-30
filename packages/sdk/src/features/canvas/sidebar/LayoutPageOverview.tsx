import { useProjectUuid } from "../../../lib/auth";
import { reads, useRead } from "../../../lib/studio-reads";
import { LayoutPageBlocks } from "./LayoutPageBlocks";
import { LayoutPageSeo, type LayoutPageTarget } from "./LayoutPageSeo";
import { PageOverview } from "./PageOverview";

/**
 * A singleton or derived page's overview: its layout's blocks, then its SEO and Markdown, which
 * its code builds.
 */
export function LayoutPageOverview({
  layoutId,
  target,
}: {
  layoutId: string;
  target: LayoutPageTarget;
}) {
  const projectUuid = useProjectUuid();
  const layout = useRead(reads.layoutStructure({ projectUuid, layoutId }));
  return (
    <PageOverview>
      <div className="flex min-h-0 flex-1 flex-col overflow-auto">
        <div className="px-2 pt-5">
          <LayoutPageBlocks layout={layout} />
        </div>
        <div className="space-y-4 p-2 pt-4">
          <LayoutPageSeo target={target} />
        </div>
      </div>
    </PageOverview>
  );
}
