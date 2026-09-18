import { Alert, AlertDescription, AlertTitle } from "@camox/ui/alert";
import { PanelContent, PanelHeader } from "@camox/ui/panel";
import { useQuery } from "@tanstack/react-query";
import { useSelector } from "@xstate/store-react";

import { useProjectSlug } from "@/lib/auth";
import { usePageBlocks } from "@/lib/normalized-data";
import { layoutQueries, projectQueries } from "@/lib/queries";

import { useCamoxApp } from "../../provider/components/CamoxAppContext";
import type { PageRenderInput } from "../../runtime/runtime";
import { previewStore, selectPreviewSource } from "../previewStore";
import { PagePicker } from "./PagePicker";
import { LayoutBlockItem } from "./PageTree";
import { PublicationRow } from "./PublicationRow";

export type DerivedLayoutStructure = NonNullable<PageRenderInput["derived"]>["layout"];
const EMPTY_PAGE = { blockIds: [] as number[] };

export function DerivedLayoutSidebar({ layout }: { layout: DerivedLayoutStructure }) {
  const source = useSelector(previewStore, selectPreviewSource);
  const { beforeBlocks, afterBlocks } = usePageBlocks({ page: EMPTY_PAGE, layout }, source);
  const app = useCamoxApp();
  const definition = app.getLayoutById(layout.layoutId);
  const layoutName = definition?._internal.title ?? layout.layoutId;
  const singleton = definition?._internal.kind === "singleton";
  const projectSlug = useProjectSlug();
  const { data: project } = useQuery(projectQueries.getBySlug(projectSlug));
  const { data: layouts } = useQuery({
    ...layoutQueries.list(project?.id ?? 0),
    enabled: !!project,
  });
  const record = layouts?.find((item) => item.id === layout.id);

  return (
    <>
      <PanelHeader className="flex flex-col gap-2 p-2">
        <div className="flex w-full">
          <PagePicker />
        </div>
        <PublicationRow
          target={record ? { kind: "layout", layout: record, name: layoutName } : null}
        />
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
          <AlertDescription>
            {singleton
              ? "Edit and publish this page’s blocks here. Its URL and structure are defined in code. Synced blocks share content with their other instances."
              : "Changes apply to every page using this layout. The generated page content is managed outside the studio."}
          </AlertDescription>
        </Alert>
      </PanelContent>
    </>
  );
}
