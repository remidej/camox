import { Button } from "@camox/ui/button";
import { toast } from "@camox/ui/toaster";
import { useMutation } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";

import { useIsEditable } from "@/core/hooks/useIsEditable";
import { useRequireDraftSource } from "@/core/hooks/useRequireDraftSource";
import { blockMutations } from "@/lib/queries";

/**
 * A block whose definition was removed from code. It renders nothing on the website; in edit
 * mode it shows this placeholder, whose only action is delete. Its content stays stored and
 * comes back if the definition does.
 */
export function RemovedBlockPlaceholder({
  blockId,
  type,
  mode,
}: {
  blockId: number;
  type: string;
  mode: "site" | "peek" | "layout";
}) {
  const isEditable = useIsEditable(mode);
  const requireDraft = useRequireDraftSource();
  const deleteBlock = useMutation(blockMutations.delete());
  if (!isEditable) return null;

  const handleDelete = async () => {
    if (!requireDraft()) return;
    try {
      await deleteBlock.mutateAsync({ id: blockId });
      toast.success(`Deleted "${type}" block`);
    } catch (error) {
      console.error("Failed to delete block:", error);
      toast.error("Could not delete block");
    }
  };

  return (
    <div className="border-border text-muted-foreground mx-4 my-2 flex items-center justify-between gap-4 rounded-md border border-dashed p-4 text-sm">
      <p>
        The <span className="text-foreground font-mono">{type}</span> block definition was removed
        from code, so this block renders nothing.
      </p>
      <Button
        variant="outline"
        size="sm"
        disabled={deleteBlock.isPending}
        onClick={() => void handleDelete()}
      >
        <Trash2 />
        Delete
      </Button>
    </div>
  );
}
