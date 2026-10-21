import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@camox/ui/alert-dialog";
import { Button } from "@camox/ui/button";
import { useMutation } from "@tanstack/react-query";
import { Trash2Icon } from "lucide-react";
import { useState } from "react";

import { collectionMutations } from "@/lib/queries";

import { reads, useStudioCache } from "../../../lib/studio-reads";

export function DeleteCollectionItemButton({
  projectUuid,
  collectionId,
  id,
  label,
  compact = false,
  disabled = false,
  onDeleted,
}: {
  projectUuid: string;
  collectionId: string;
  id: string;
  label: string;
  compact?: boolean;
  disabled?: boolean;
  onDeleted?: () => Promise<void> | void;
}) {
  const studioCache = useStudioCache();
  const [target, setTarget] = useState<{ label: string } | null>(null);
  const deletion = useMutation(collectionMutations.delete());

  const confirmDelete = async () => {
    if (!target || deletion.isPending) return;
    try {
      await deletion.mutateAsync({ projectUuid, collectionId, id });
    } catch {
      // Keep the dialog open so the error can be read and the operation retried.
      return;
    }
    setTarget(null);
    await onDeleted?.();
    studioCache.remove(reads.record({ projectUuid, collectionId, id }));
    await studioCache.invalidate(reads.records({ projectUuid, collectionId }));
  };

  return (
    <AlertDialog
      open={!!target}
      onOpenChange={(open) => {
        if (deletion.isPending) return;
        deletion.reset();
        setTarget(open ? { label: label || "Untitled item" } : null);
      }}
    >
      <AlertDialogTrigger
        render={
          <Button
            type="button"
            variant={compact ? "ghost" : "destructive"}
            size={compact ? "icon-sm" : "default"}
            disabled={disabled}
            aria-label={compact ? `Delete ${label || "Untitled item"}` : undefined}
            className={
              compact
                ? "text-destructive mr-2 shrink-0 group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:hover)]:opacity-0"
                : "ml-auto"
            }
          />
        }
      >
        <Trash2Icon aria-hidden />
        {!compact && "Delete item"}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete item?</AlertDialogTitle>
          <AlertDialogDescription>
            Delete “{target?.label}”? This cannot be undone. Media-library files will be kept.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {deletion.isError && (
          <p role="alert" className="text-destructive text-sm">
            {deletion.error.message}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deletion.isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            type="button"
            variant="destructive"
            disabled={deletion.isPending}
            onClick={() => void confirmDelete()}
          >
            {deletion.isPending ? "Deleting…" : "Delete item"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
