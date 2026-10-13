import { Alert, AlertDescription, AlertTitle } from "@camox/ui/alert";
import { PanelContent, PanelHeader } from "@camox/ui/panel";
import { useQuery } from "@tanstack/react-query";
import { useSelector } from "@xstate/store-react";

import { useProjectSlug } from "@/lib/auth";
import { usePageBlocks } from "@/lib/normalized-data";
import { collectionQueries, layoutQueries, projectQueries } from "@/lib/queries";

import { useCamoxApp } from "../../provider/components/CamoxAppContext";
import type { PageRenderInput } from "../../runtime/runtime";
import { previewStore, selectPreviewSource } from "../previewStore";
import type { PageRecordId, PublicationTarget } from "../publication";
import { PagePicker } from "./PagePicker";
import { LayoutBlockItem } from "./PageTree";
import { PublicationRow } from "./PublicationRow";

export type DerivedLayoutStructure = NonNullable<PageRenderInput["derived"]>["layout"];
const EMPTY_PAGE = { blockIds: [] as number[] };

export function DerivedLayoutSidebar({
  layout,
  pageRecord,
}: {
  layout: DerivedLayoutStructure;
  pageRecord?: PageRecordId;
}) {
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
  // Publication refreshes this list, so the switch follows the record's status.
  const { data: pageRecordStatus } = useQuery({
    ...collectionQueries.records(projectSlug, pageRecord?.collectionId ?? ""),
    enabled: !!pageRecord,
    select: (records) => records.find((item) => item.id === pageRecord?.id)?.status,
  });
  const target: PublicationTarget | null = record
    ? {
        kind: "layout",
        layout: record,
        name: layoutName,
        ...(pageRecord && pageRecordStatus
          ? { record: { ...pageRecord, status: pageRecordStatus } }
          : {}),
      }
    : null;

  return (
    <>
      <PanelHeader className="flex flex-col gap-2 p-2">
        <div className="flex w-full">
          <PagePicker />
        </div>
        <PublicationRow target={target} />
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
              ? "Edit and publish this page’s blocks here. Its URL and structure are defined in code. Synced blocks share content with their other placements."
              : pageRecord
                ? "Changes to these blocks apply to every page using this layout. Select this page’s content in the preview to edit its record, shared everywhere it appears."
                : "Changes apply to every page using this layout. The generated page content is managed outside the studio."}
          </AlertDescription>
        </Alert>
      </PanelContent>
    </>
  );
}
