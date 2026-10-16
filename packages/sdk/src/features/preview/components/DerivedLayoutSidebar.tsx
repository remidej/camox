import { Alert, AlertDescription, AlertTitle } from "@camox/ui/alert";
import { PanelContent, PanelHeader } from "@camox/ui/panel";

import { usePageBlocks } from "@/lib/normalized-data";

import { useCamoxApp } from "../../provider/components/CamoxAppContext";
import type { PageRenderInput } from "../../runtime/runtime";
import type { PageRecordId } from "../pageRecord";
import { PagePicker } from "./PagePicker";
import { LayoutBlockItem } from "./PageTree";

export type DerivedLayoutStructure = NonNullable<PageRenderInput["derived"]>["layout"];
const EMPTY_PAGE = { blockIds: [] as string[] };

/** Where this page's content is edited, and what its layout's blocks change. */
function layoutNotice(singleton: boolean, recordPage: boolean) {
  if (singleton)
    return "Edit this page’s blocks here. Its URL and structure are defined in code. Synced blocks share content with their other placements.";
  if (recordPage)
    return "Changes to these blocks apply to every page using this layout. Select this page’s content in the preview to edit its record, shared everywhere it appears.";
  return "Changes apply to every page using this layout. The generated page content is managed outside the studio.";
}

export function DerivedLayoutSidebar({
  layout,
  pageRecord,
}: {
  layout: DerivedLayoutStructure;
  pageRecord?: PageRecordId;
}) {
  const { beforeBlocks, afterBlocks } = usePageBlocks({ page: EMPTY_PAGE, layout });
  const app = useCamoxApp();
  const definition = app.getLayoutById(layout.layoutId);
  const layoutName = definition?._internal.title ?? layout.layoutId;
  const singleton = definition?._internal.kind === "singleton";

  return (
    <>
      <PanelHeader className="flex flex-col gap-2 p-2">
        <div className="flex w-full">
          <PagePicker />
        </div>
      </PanelHeader>
      <PanelContent className="flex grow basis-0 flex-col gap-4 overflow-auto p-2">
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
                <LayoutBlockItem key={block.id} block={block} layoutName={layoutName} derived />
              ))
            )}
          </section>
        ))}
        <Alert>
          <AlertTitle>{singleton ? "Code-owned page" : "Shared layout blocks"}</AlertTitle>
          <AlertDescription>{layoutNotice(singleton, !!pageRecord)}</AlertDescription>
        </Alert>
      </PanelContent>
    </>
  );
}
