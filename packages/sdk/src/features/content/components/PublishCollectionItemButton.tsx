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
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal } from "lucide-react";
import { useState } from "react";

import { PublishDialog } from "@/features/preview/components/PublishDialog";
import { collectionMutations, collectionQueries } from "@/lib/queries";

type RecordSummary = {
  id: string;
  version: number;
  label: string;
  status: "draft" | "modified" | "published";
};

export function PublishCollectionItemButton({
  projectSlug,
  collectionId,
  record,
}: {
  projectSlug: string;
  collectionId: string;
  record: RecordSummary;
}) {
  // Freeze the reviewed version: background refetches must not silently publish
  // someone else's new edits while a confirmation is open.
  const [target, setTarget] = useState<
    (RecordSummary & { action: "publish" | "unpublish" | "discard" }) | null
  >(null);
  const publication = useMutation(collectionMutations.publish());
  const removal = useMutation(collectionMutations.unpublish());
  const discard = useMutation(collectionMutations.discard());
  const queryClient = useQueryClient();
  const pending = publication.isPending || removal.isPending || discard.isPending;
  const error = publication.error?.message ?? removal.error?.message ?? discard.error?.message;
  const close = () => {
    if (pending) return;
    setTarget(null);
    publication.reset();
    removal.reset();
    discard.reset();
  };
  const confirm = async () => {
    if (!target || pending) return;
    const input = { projectSlug, collectionId, id: target.id, expectedVersion: target.version };
    try {
      const saved =
        target.action === "publish"
          ? (await publication.mutateAsync(input)).record
          : target.action === "discard"
            ? await discard.mutateAsync(input)
            : await removal.mutateAsync(input);
      queryClient.setQueryData(
        collectionQueries.record(projectSlug, collectionId, saved.id).queryKey,
        saved,
      );
      setTarget(null);
    } catch {
      // Keep the reviewed version and error visible. Reload before retrying a conflict.
    }
    await queryClient.invalidateQueries({
      queryKey: collectionQueries.records(projectSlug, collectionId).queryKey,
    });
  };

  return (
    <div className="flex items-center gap-2 px-2">
      <ButtonGroup className="opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
        <Button
          size="sm"
          variant="outline"
          disabled={pending || record.status === "published"}
          onClick={() => setTarget({ ...record, action: "publish" })}
        >
          {record.status === "modified" ? "Publish changes" : "Publish"}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="outline" size="icon-sm" aria-label="More publish actions" />}
          >
            <MoreHorizontal className="text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              disabled={pending || record.status === "draft"}
              onClick={() => setTarget({ ...record, action: "unpublish" })}
            >
              Unpublish
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={pending || record.status !== "modified"}
              onClick={() => setTarget({ ...record, action: "discard" })}
            >
              Discard changes
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </ButtonGroup>
      {target?.action === "publish" && (
        <PublishDialog
          plan={{
            title: "Publish item",
            description:
              "Publishes this saved draft independently. No page, block, or other item is published.",
            items: [
              {
                key: target.id,
                label: target.label || "Untitled item",
                switchLabel: `Publish ${target.label || "Untitled item"}`,
                impact:
                  "Makes the saved content available to live reads. Later draft edits stay private until published again.",
                optional: true,
              },
            ],
          }}
          pending={pending}
          error={error}
          onOpenChange={(open) => !open && close()}
          onPublish={(keys) => keys.includes(target.id) && void confirm()}
        />
      )}
      {target && target.action !== "publish" && (
        <AlertDialog open onOpenChange={(open) => !open && close()}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {target.action === "discard" ? "Discard draft changes?" : "Unpublish item?"}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {target.action === "discard"
                  ? `Reset “${target.label || "Untitled item"}” to its published version. This does not change what visitors see.`
                  : `Remove “${target.label || "Untitled item"}” from live reads. Its draft and history are kept.`}
              </AlertDialogDescription>
            </AlertDialogHeader>
            {error && (
              <p role="alert" className="text-destructive text-sm">
                {error}
              </p>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={pending}
                onClick={(event) => {
                  event.preventDefault();
                  void confirm();
                }}
              >
                {pending
                  ? "Updating…"
                  : target.action === "discard"
                    ? "Discard changes"
                    : "Unpublish"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}
