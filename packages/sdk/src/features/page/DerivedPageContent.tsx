import type { CamoxApp } from "../../core/createApp";
import { usePageBlocks } from "../../lib/normalized-data";
import type { PageRenderInput } from "../runtime/runtime";
import { SharedLayoutContent } from "./SharedLayoutContent";

const EMPTY_PAGE = { blockIds: [] as number[] };

export function DerivedPageContent({
  camoxApp,
  derived,
  source,
}: {
  camoxApp: CamoxApp;
  derived: NonNullable<PageRenderInput["derived"]>;
  source: PageRenderInput["source"];
}) {
  const { beforeBlocks, afterBlocks, layoutFiles, layoutItems } = usePageBlocks(
    { page: EMPTY_PAGE, layout: derived.layout },
    source,
  );
  const layout = camoxApp.getLayoutById(derived.layoutId);
  if (!layout) throw new Error(`Unknown derived layout: ${derived.layoutId}`);
  return (
    <SharedLayoutContent
      layout={layout}
      result={derived.result}
      blocks={[...beforeBlocks, ...afterBlocks]}
      files={layoutFiles}
      repeatableItems={layoutItems}
    />
  );
}
