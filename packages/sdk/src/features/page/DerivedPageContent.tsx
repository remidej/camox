import type { CamoxApp } from "../../core/createApp";
import { buildLayoutContext } from "../../core/layoutContext";
import { asCollectionItem, recordPageValues } from "../../core/recordItem";
import { usePageBlocks } from "../../lib/normalized-data";
import { useViewLocale } from "../../lib/view-locale-context";
import type { PageRenderInput } from "../runtime/runtime";
import { SharedLayoutContent } from "./SharedLayoutContent";

const EMPTY_PAGE = { blockIds: [] as string[] };

export function DerivedPageContent({
  camoxApp,
  derived,
}: {
  camoxApp: CamoxApp;
  derived: NonNullable<PageRenderInput["derived"]>;
}) {
  const { beforeBlocks, afterBlocks, layoutFiles, layoutItems } = usePageBlocks({
    page: EMPTY_PAGE,
    layout: derived.layout,
  });
  const { locale } = useViewLocale();
  const layout = camoxApp.getLayoutById(derived.layoutId);
  if (!layout) throw new Error(`Unknown derived layout: ${derived.layoutId}`);
  const { page, result } = derived;
  const record = asCollectionItem(result);
  const collection = record && camoxApp.getCollectionById(record.collectionId);
  const context = buildLayoutContext(layout._internal, {
    path: page?.path ?? "",
    locale: locale.tag,
    projectName: page?.projectName ?? "",
    data: result?.data,
    params: page?.params,
    record: record && collection ? recordPageValues(collection, record.data.content) : undefined,
  });
  return (
    <SharedLayoutContent
      layout={layout}
      context={context}
      result={result}
      blocks={[...beforeBlocks, ...afterBlocks]}
      files={layoutFiles}
      repeatableItems={layoutItems}
    />
  );
}
