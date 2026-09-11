import { queryKeys } from "@camox/api-contract/query-keys";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@camox/ui/alert-dialog";
import { Button } from "@camox/ui/button";
import { ButtonGroup } from "@camox/ui/button-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@camox/ui/dropdown-menu";
import { PanelContent, PanelHeader } from "@camox/ui/panel";
import { toast } from "@camox/ui/toaster";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSelector } from "@xstate/store-react";
import { MoreHorizontal } from "lucide-react";
import * as React from "react";

import { useLocation } from "@/features/navigation/navigation";
import { type Page, pageMutations, type PageStructure } from "@/lib/queries";
import { trackClientEvent } from "@/lib/telemetry-client";

import { type Action, actionsStore } from "../../provider/actionsStore";
import { previewStore } from "../previewStore";
import { PagePicker } from "./PagePicker";
import { PageTree } from "./PageTree";
import { PublishDialog } from "./PublishDialog";

export type PreviewedPage = {
  id: number;
  metaTitle: string | null;
  pathSegment: string;
  fullPath: string;
  livePublishedCheckpointId: number | null;
  status: "draft" | "published" | "modified";
  modifiedReason:
    | { reason: "self" }
    | { reason: "layout"; layoutId: number; layoutHandle: string; affectedPagesCount: number }
    | { reason: "both"; layoutId: number; layoutHandle: string; affectedPagesCount: number }
    | null;
};

const PageNavigatorPublishRow = ({ page }: { page: PreviewedPage }) => {
  const previewSource = useSelector(previewStore, (state) => state.context.previewSource);
  const queryClient = useQueryClient();
  const { pathname } = useLocation();
  const [isPublishDialogOpen, setIsPublishDialogOpen] = React.useState(false);
  const [isUnpublishDialogOpen, setIsUnpublishDialogOpen] = React.useState(false);
  const [isDiscardDialogOpen, setIsDiscardDialogOpen] = React.useState(false);
  const unpublishPage = useMutation(pageMutations.unpublish());
  const discardChanges = useMutation(pageMutations.discardChanges());

  const hasLiveCheckpoint = page.livePublishedCheckpointId != null;
  const isHomePage = page.fullPath === "/";

  const hasChangesToPublish = page.status === "draft" || page.status === "modified";
  const canPublish = hasChangesToPublish && previewSource === "draft";
  const canDiscardChanges = page.status === "modified";
  const layoutCascade =
    page.modifiedReason &&
    (page.modifiedReason.reason === "layout" || page.modifiedReason.reason === "both")
      ? {
          layoutHandle: page.modifiedReason.layoutHandle,
          affectedPagesCount: page.modifiedReason.affectedPagesCount,
        }
      : null;
  const publishLabel = page.status === "modified" ? "Publish changes" : "Publish page";

  React.useEffect(() => {
    const actions: Action[] = [
      {
        id: "publish-current-page",
        label: publishLabel,
        aliases: ["Publish", "Publish page", "Make live"],
        groupLabel: "Preview",
        checkIfAvailable: () => canPublish,
        execute: () => setIsPublishDialogOpen(true),
      },
      {
        id: "unpublish-current-page",
        label: "Unpublish page",
        aliases: ["Take offline", "Remove from live", "Hide page"],
        groupLabel: "Preview",
        checkIfAvailable: () => hasLiveCheckpoint && !isHomePage && !unpublishPage.isPending,
        execute: () => setIsUnpublishDialogOpen(true),
      },
      {
        id: "discard-current-page-changes",
        label: "Discard page changes",
        aliases: ["Revert page", "Reset page", "Discard draft"],
        groupLabel: "Preview",
        checkIfAvailable: () => canDiscardChanges && !discardChanges.isPending,
        execute: () => setIsDiscardDialogOpen(true),
      },
    ];

    actionsStore.send({ type: "registerManyActions", actions });
    return () =>
      actionsStore.send({ type: "unregisterManyActions", ids: actions.map((a) => a.id) });
  }, [
    canDiscardChanges,
    canPublish,
    discardChanges.isPending,
    hasLiveCheckpoint,
    isHomePage,
    publishLabel,
    unpublishPage.isPending,
  ]);

  const handleUnpublish = async () => {
    if (isHomePage) return;
    try {
      await unpublishPage.mutateAsync({ id: page.id });
      queryClient.setQueryData<PageStructure>(
        queryKeys.pages.getByPath(pathname, "draft"),
        (current) =>
          current
            ? {
                ...current,
                page: {
                  ...current.page,
                  livePublishedCheckpointId: null,
                  status: "draft",
                  modifiedReason: null,
                },
              }
            : current,
      );
      queryClient.setQueryData<Page[]>(queryKeys.pages.list, (current) =>
        current?.map((item) =>
          item.id === page.id
            ? { ...item, livePublishedCheckpointId: null, status: "draft", modifiedReason: null }
            : item,
        ),
      );
      previewStore.send({ type: "setPreviewSource", source: "draft" });
      trackClientEvent("page_unpublished", { pageId: page.id });
      toast.success("Unpublished this page");
      setIsUnpublishDialogOpen(false);
    } catch (error) {
      console.error("Failed to unpublish page:", error);
      toast.error("Could not unpublish this page");
    }
  };

  const handleDiscardChanges = async () => {
    try {
      await discardChanges.mutateAsync({ id: page.id });
      previewStore.send({ type: "setPreviewSource", source: "draft" });
      trackClientEvent("page_changes_discarded", { pageId: page.id });
      toast.success("Discarded draft changes");
      setIsDiscardDialogOpen(false);
    } catch (error) {
      console.error("Failed to discard page changes:", error);
      toast.error("Could not discard draft changes");
    }
  };

  return (
    <>
      <div className="flex flex-col gap-2">
        <ButtonGroup className="w-full">
          <Button
            variant="outline"
            type="button"
            disabled={!canPublish}
            onClick={() => setIsPublishDialogOpen(true)}
            className="flex-1"
          >
            {publishLabel}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label="More publish actions"
                />
              }
            >
              <MoreHorizontal className="text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-42">
              <DropdownMenuItem
                disabled={!hasLiveCheckpoint || isHomePage || unpublishPage.isPending}
                onClick={() => setIsUnpublishDialogOpen(true)}
              >
                Unpublish
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!canDiscardChanges || discardChanges.isPending}
                onClick={() => setIsDiscardDialogOpen(true)}
              >
                Discard changes
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </ButtonGroup>
      </div>
      <PublishDialog
        page={isPublishDialogOpen ? page : null}
        pageStatus={page.status}
        alsoPublishLayout={layoutCascade}
        open={isPublishDialogOpen}
        onOpenChange={setIsPublishDialogOpen}
      />
      <AlertDialog open={isUnpublishDialogOpen} onOpenChange={setIsUnpublishDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unpublish page</AlertDialogTitle>
            <AlertDialogDescription>
              Visitors at{" "}
              <code className="bg-muted rounded px-1 py-0.5 font-mono text-xs">
                {page.fullPath}
              </code>{" "}
              will get a 404. The draft stays available in Camox Studio.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel variant="outline" size="default" disabled={unpublishPage.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleUnpublish}
              disabled={isHomePage || unpublishPage.isPending}
            >
              {unpublishPage.isPending ? "Unpublishing…" : "Unpublish"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={isDiscardDialogOpen} onOpenChange={setIsDiscardDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard draft changes</AlertDialogTitle>
            <AlertDialogDescription>
              The draft for{" "}
              <code className="bg-muted rounded px-1 py-0.5 font-mono text-xs">
                {page.fullPath}
              </code>{" "}
              will be reset to match the currently published version. This does not change what
              visitors see.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel variant="outline" size="default" disabled={discardChanges.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleDiscardChanges} disabled={discardChanges.isPending}>
              {discardChanges.isPending ? "Discarding…" : "Discard changes"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export const PageNavigatorHeader = ({ page }: { page: PreviewedPage }) => (
  <PanelHeader className="flex flex-col gap-2 px-2 pt-2 pb-3">
    <div className="flex w-full">
      <PagePicker />
    </div>
    <PageNavigatorPublishRow page={page} />
  </PanelHeader>
);

const PageNavigatorSidebar = ({ page }: { page: PreviewedPage }) => {
  return (
    <>
      <PageNavigatorHeader page={page} />
      <PanelContent className="flex grow basis-0 flex-col gap-2 overflow-auto p-2">
        <PageTree />
      </PanelContent>
    </>
  );
};

export { PageNavigatorSidebar };
