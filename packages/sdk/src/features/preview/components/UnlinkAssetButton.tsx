import { api } from "camox/_generated/api";
import type { Id } from "camox/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { X } from "lucide-react";
import { useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface UnlinkAssetButtonProps {
  fileId: Id<"files"> | undefined;
  onUnlink: () => void;
  className?: string;
}

const UnlinkAssetButton = ({ fileId, onUnlink, className }: UnlinkAssetButtonProps) => {
  const [dialogOpen, setDialogOpen] = useState(false);
  const usageCount = useQuery(api.files.getFileUsageCount, fileId ? { fileId } : "skip");
  const deleteFile = useMutation(api.files.deleteFile);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!fileId || usageCount === undefined || usageCount > 1) {
      onUnlink();
      return;
    }
    setDialogOpen(true);
  };

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className={cn("text-muted-foreground hover:text-foreground shrink-0", className)}
            onClick={handleClick}
          >
            <X className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Unlink</TooltipContent>
      </Tooltip>
      <AlertDialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unlink file</AlertDialogTitle>
            <AlertDialogDescription>
              This file is not used anywhere else. Would you like to also delete it?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => onUnlink()} asChild>
              <Button variant="outline" className="text-foreground">
                Unlink only
              </Button>
            </AlertDialogAction>
            <AlertDialogAction
              onClick={() => {
                onUnlink();
                if (fileId) deleteFile({ fileId });
              }}
              asChild
            >
              <Button>Delete file</Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export { UnlinkAssetButton };
