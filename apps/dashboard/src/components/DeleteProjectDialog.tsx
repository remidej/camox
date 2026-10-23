import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@camox/ui/alert-dialog";
import { Button } from "@camox/ui/button";
import { Input } from "@camox/ui/input";
import { Label } from "@camox/ui/label";
import { Spinner } from "@camox/ui/spinner";
import { toast } from "@camox/ui/toaster";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { api, type Project } from "@/lib/api";
import { projectQueries } from "@/lib/queries";

/**
 * Asks the member to type the project's slug before deleting it. Once it's deleted, the
 * organization's project list refreshes.
 */
export function DeleteProjectDialog({
  project,
  open,
  onOpenChange,
}: {
  project: Project;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [confirmValue, setConfirmValue] = useState("");
  const queryClient = useQueryClient();

  const deleteProject = useMutation({
    mutationFn: () => api.projects.delete({ id: project.id }),
    onSuccess: async () => {
      await queryClient.invalidateQueries(projectQueries.list(project.organizationId));
      toast.success("Project deleted");
      onOpenChange(false);
      setConfirmValue("");
    },
    onError: (error) => {
      console.error("Failed to delete project:", error);
      toast.error("Could not delete project");
    },
  });

  return (
    <AlertDialog
      open={open}
      onOpenChange={(value) => {
        onOpenChange(value);
        if (!value) setConfirmValue("");
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete project</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently delete the project <strong>{project.name}</strong> and all of its
            data including drafts, pages, blocks, and files. This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2">
          <Label htmlFor={`confirm-slug-${project.id}`}>
            Type <span className="font-mono font-semibold">{project.slug}</span> to confirm
          </Label>
          <Input
            id={`confirm-slug-${project.id}`}
            value={confirmValue}
            onChange={(e) => setConfirmValue(e.target.value)}
            placeholder={project.slug}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel variant="outline" size="default">
            Cancel
          </AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={confirmValue !== project.slug || deleteProject.isPending}
            onClick={() => deleteProject.mutate()}
          >
            {deleteProject.isPending && <Spinner />}
            Delete project
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
