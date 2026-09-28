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
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2Icon } from "lucide-react";
import { useState } from "react";

import { collectionMutations, collectionQueries } from "@/lib/queries";

export function DeleteCollectionItemButton({
  projectSlug,
  collectionId,
  id,
  version,
  label,
  compact = false,
  disabled = false,
  onDeleted,
}: {
  projectSlug: string;
  collectionId: string;
  id: string;
  version: number;
  label: string;
  compact?: boolean;
  disabled?: boolean;
  onDeleted?: () => Promise<void> | void;
}) {
  const [target, setTarget] = useState<{ version: number; label: string } | null>(null);
  const queryClient = useQueryClient();
  const deletion = useMutation(collectionMutations.delete());

  const confirmDelete = async () => {
    if (!target || deletion.isPending) return;
    try {
      await deletion.mutateAsync({
        projectSlug,
        collectionId,
        id,
        expectedVersion: target.version,
      });
    } catch {
      // Keep the dialog open so the error can be read and the operation retried.
      return;
    }
    setTarget(null);
    await onDeleted?.();
    queryClient.removeQueries({
      queryKey: collectionQueries.record(projectSlug, collectionId, id).queryKey,
    });
    await queryClient.invalidateQueries({
      queryKey: collectionQueries.records(projectSlug, collectionId).queryKey,
    });
  };

  return (
    <AlertDialog
      open={!!target}
      onOpenChange={(open) => {
        if (deletion.isPending) return;
        deletion.reset();
        setTarget(open ? { version, label: label || "Untitled item" } : null);
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
            Delete “{target?.label}” and all its revision history? This cannot be undone.
            Media-library files will be kept.
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
