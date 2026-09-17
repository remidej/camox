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
import { toast } from "@camox/ui/toaster";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSelector } from "@xstate/store-react";
import { MoreHorizontal } from "lucide-react";
import * as React from "react";

import { getApiClient } from "@/lib/api-client";

import { type Action, actionsStore } from "../../provider/actionsStore";
import { previewStore, selectPreviewSource } from "../previewStore";
import {
  buildPublicationPlan,
  getPublicationCapabilities,
  getPublicationRequest,
  type PublicationTarget,
} from "../publication";
import { PublishDialog } from "./PublishDialog";

type Operation = "publish" | "unpublish" | "discard";

export function PublicationRow({ target }: { target: PublicationTarget | null }) {
  const identity = target
    ? `${target.kind}:${target.kind === "page" ? target.page.id : target.layout.id}`
    : "loading";
  return <PublicationControls key={identity} target={target} />;
}

function PublicationControls({ target }: { target: PublicationTarget | null }) {
  const source = useSelector(previewStore, selectPreviewSource);
  const queryClient = useQueryClient();
  const [action, setAction] = React.useState<Operation | null>(null);
  const plan = target ? buildPublicationPlan(target) : null;
  const capabilities = getPublicationCapabilities(target, source);

  // One execution boundary for every entry point. Page + layout publishing uses
  // the existing bundled endpoint, never independent requests for dependencies.
  const mutation = useMutation({
    mutationFn: async ({
      operation,
      includedKeys = [],
    }: {
      operation: Operation;
      includedKeys?: string[];
    }) => {
      if (!target || !capabilities[operation]) throw new Error("Publication action is unavailable");
      const api = getApiClient();
      if (operation === "publish") {
        const request = getPublicationRequest(target, includedKeys);
        if (request.kind === "layout") {
          await api.layouts.publish(request.input);
          return;
        }
        await api.pages.publish(request.input);
        return;
      }
      if (target.kind === "layout") {
        await api.layouts.unpublish({ id: target.layout.id });
        return;
      }
      if (operation === "discard") {
        await api.pages.discardChanges({ id: target.page.id });
        return;
      }
      await api.pages.unpublish({ id: target.page.id });
    },
    onSuccess: async (_, { operation }) => {
      if (operation !== "publish") previewStore.send({ type: "viewDraftPage" });
      setAction(null);
      toast.success(
        operation === "publish"
          ? "Published selected changes"
          : operation === "unpublish"
            ? "Unpublished successfully"
            : "Discarded draft changes",
      );
      // Publication may affect other pages and shared blocks. Do not rely only
      // on the realtime broadcast to refresh the initiating client's view.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.layouts.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.pages.list }),
        queryClient.invalidateQueries({ queryKey: queryKeys.pages.getByPathAll }),
        queryClient.invalidateQueries({ queryKey: ["camox", "pages", "getById"] }),
        queryClient.invalidateQueries({ queryKey: ["camox", "blocks", "get"] }),
      ]);
    },
    onError: () => toast.error("Could not complete this action. Please try again."),
  });
  const canPublish = capabilities.publish && !mutation.isPending;
  const canUnpublish = capabilities.unpublish && !mutation.isPending;
  const canDiscard = capabilities.discard && !mutation.isPending;
  const publishLabel = plan?.title ?? "Publish changes";
  const kind = target?.kind;

  React.useEffect(() => {
    if (!kind) return;
    const actions: Action[] = [
      {
        id: `publish-current-${kind}`,
        label: publishLabel,
        aliases: ["Publish", "Make live"],
        groupLabel: "Preview",
        checkIfAvailable: () => canPublish,
        execute: () => setAction("publish"),
      },
      {
        id: `unpublish-current-${kind}`,
        label: `Unpublish ${kind}`,
        aliases: ["Take offline", "Remove from live"],
        groupLabel: "Preview",
        checkIfAvailable: () => canUnpublish,
        execute: () => setAction("unpublish"),
      },
    ];
    if (kind === "page")
      actions.push({
        id: "discard-current-page-changes",
        label: "Discard page changes",
        aliases: ["Revert page", "Reset page", "Discard draft"],
        groupLabel: "Preview",
        checkIfAvailable: () => canDiscard,
        execute: () => setAction("discard"),
      });
    actionsStore.send({ type: "registerManyActions", actions });
    return () =>
      actionsStore.send({ type: "unregisterManyActions", ids: actions.map((item) => item.id) });
  }, [kind, publishLabel, canPublish, canUnpublish, canDiscard]);

  return (
    <>
      <ButtonGroup className="w-full">
        <Button
          variant="outline"
          className="flex-1"
          disabled={!canPublish}
          onClick={() => setAction("publish")}
        >
          {publishLabel}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="outline" size="icon" aria-label="More publish actions" />}
          >
            <MoreHorizontal className="text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem disabled={!canUnpublish} onClick={() => setAction("unpublish")}>
              Unpublish
            </DropdownMenuItem>
            {kind === "page" && (
              <DropdownMenuItem disabled={!canDiscard} onClick={() => setAction("discard")}>
                Discard changes
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </ButtonGroup>
      {action === "publish" && plan && (
        <PublishDialog
          plan={plan}
          pending={mutation.isPending}
          onPublish={(includedKeys) => {
            if (canPublish) mutation.mutate({ operation: "publish", includedKeys });
          }}
          onOpenChange={(open) => !open && setAction(null)}
        />
      )}
      <AlertDialog
        open={action === "unpublish" || action === "discard"}
        onOpenChange={(open) => !open && !mutation.isPending && setAction(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {action === "discard" ? "Discard draft changes" : `Unpublish ${kind ?? ""}`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {action === "discard" ? (
                <>
                  The draft for {target?.kind === "page" && target.page.fullPath} will be reset to
                  its published version. Shared layout changes are not discarded. This does not
                  change what visitors see.
                </>
              ) : target?.kind === "layout" ? (
                <>
                  This removes the shared before and after blocks from every live page using{" "}
                  {target.name}, including all derived URLs. The generated content and draft blocks
                  stay available.
                </>
              ) : (
                <>
                  Visitors at {target?.page.fullPath} will get a 404. The draft stays available.
                  Shared layout blocks remain published for other pages.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel variant="outline" disabled={mutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={action === "discard" ? !canDiscard : !canUnpublish}
              onClick={(event) => {
                event.preventDefault();
                if (action === "discard" && canDiscard) mutation.mutate({ operation: action });
                if (action === "unpublish" && canUnpublish) mutation.mutate({ operation: action });
              }}
            >
              {mutation.isPending
                ? "Updating…"
                : action === "discard"
                  ? "Discard changes"
                  : "Unpublish"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
