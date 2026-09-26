import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@camox/ui/alert-dialog";
import { Button } from "@camox/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@camox/ui/tooltip";
import { useMutation, useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useState } from "react";

import { fileMutations, fileQueries } from "@/lib/queries";
import { cn } from "@/lib/utils";

interface UnlinkAssetButtonProps {
  fileId: number | undefined;
  onUnlink: () => void;
  className?: string;
  persisted?: boolean;
}

const UnlinkAssetButton = ({
  fileId,
  onUnlink,
  className,
  persisted = true,
}: UnlinkAssetButtonProps) => {
  const [dialogOpen, setDialogOpen] = useState(false);
  const deleteFile = useMutation(fileMutations.delete());
  const { data: usageCount } = useQuery({
    ...fileQueries.getUsageCount(fileId!),
    enabled: !!fileId,
  });
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!fileId || usageCount === undefined || usageCount > (persisted ? 1 : 0)) {
      onUnlink();
      return;
    }
    setDialogOpen(true);
  };

  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className={cn("text-muted-foreground hover:text-foreground shrink-0", className)}
              onClick={handleClick}
            />
          }
        >
          <X className="h-4 w-4" />
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
            <AlertDialogAction
              variant="outline"
              className="bg-background hover:bg-accent text-foreground"
              onClick={() => onUnlink()}
            >
              Unlink only
            </AlertDialogAction>
            <AlertDialogAction
              onClick={() => {
                onUnlink();
                if (fileId) deleteFile.mutate({ id: fileId });
              }}
            >
              Delete file
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export { UnlinkAssetButton };
