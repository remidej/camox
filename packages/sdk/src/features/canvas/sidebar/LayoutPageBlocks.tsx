import { usePageBlocks } from "@/lib/normalized-data";

import type { LayoutStructure } from "../../../lib/studio-reads";
import { BlocksGroup, CollapsedPageTree, LayoutBlockItem } from "../../preview/components/PageTree";
import { useCamoxApp } from "../../provider/components/CamoxAppContext";

const EMPTY_PAGE = { blockIds: [] as string[] };

/** A layout page's blocks: all its layout's, before and after where page content would be. */
export function LayoutPageBlocks({ layout }: { layout: LayoutStructure }) {
  const { beforeBlocks, afterBlocks } = usePageBlocks({ page: EMPTY_PAGE, layout });
  const app = useCamoxApp();
  const layoutName = app.getLayoutById(layout.layoutId)?._internal.title ?? layout.layoutId;

  return (
    <BlocksGroup>
      <CollapsedPageTree blockCount={beforeBlocks.length + afterBlocks.length}>
        <div className="flex flex-col gap-4 py-1">
          {(
            [
              ["Before", beforeBlocks],
              ["After", afterBlocks],
            ] as const
          ).map(([title, blocks]) => (
            <section key={title} className="space-y-1">
              <h2 className="text-muted-foreground px-2 text-xs font-medium">{title}</h2>
              {blocks.length === 0 ? (
                <p className="text-muted-foreground px-2 py-2 text-sm">
                  No {title.toLowerCase()} blocks
                </p>
              ) : (
                blocks.map((block) => (
                  <LayoutBlockItem
                    key={block.id}
                    block={block}
                    layoutName={layoutName}
                    withActions={false}
                  />
                ))
              )}
            </section>
          ))}
        </div>
      </CollapsedPageTree>
    </BlocksGroup>
  );
}
