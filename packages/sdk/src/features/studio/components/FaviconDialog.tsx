import { Alert, AlertDescription } from "@camox/ui/alert";
import { Button } from "@camox/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@camox/ui/dialog";
import { FaviconDropZone, validateFaviconFile } from "@camox/ui/favicon-drop-zone";
import { Spinner } from "@camox/ui/spinner";
import { toast } from "@camox/ui/toaster";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2, TriangleAlert } from "lucide-react";
import * as React from "react";

import { buildFaviconPlaceholderUrl, buildFaviconUrl } from "@/features/routes/pageRuntime";
import { getApiUrl } from "@/lib/api-client";
import { type Project, projectMutations, projectQueries } from "@/lib/queries";

type PendingChange = { type: "upload"; file: File } | { type: "remove" } | null;

/** Points the studio tab's own icon at the saved favicon, so the change shows without a reload. */
function refreshDocumentFavicon(href: string) {
  for (const link of document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]')) {
    link.href = href;
  }
}

export function FaviconDialog({
  project,
  open,
  onOpenChange,
}: {
  project: Project;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-5 sm:max-w-md">
        <FaviconForm project={project} onSaved={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function FaviconForm({ project, onSaved }: { project: Project; onSaved: () => void }) {
  const queryClient = useQueryClient();
  const [pending, setPending] = React.useState<PendingChange>(null);
  const [hasCurrent, setHasCurrent] = React.useState(false);
  const currentUrl = buildFaviconUrl(getApiUrl(), project, { placeholder: false });

  // Without the placeholder the current favicon 404s when none was uploaded, which tells us
  // whether there is one to show and remove.
  React.useEffect(() => {
    const probe = new Image();
    probe.onload = () => setHasCurrent(true);
    probe.onerror = () => setHasCurrent(false);
    probe.src = currentUrl;
    return () => {
      probe.onload = null;
      probe.onerror = null;
    };
  }, [currentUrl]);

  const pendingFile = pending?.type === "upload" ? pending.file : null;
  const pendingUrl = React.useMemo(
    () => (pendingFile ? URL.createObjectURL(pendingFile) : null),
    [pendingFile],
  );
  React.useEffect(() => {
    if (!pendingUrl) return;
    return () => URL.revokeObjectURL(pendingUrl);
  }, [pendingUrl]);

  const onSuccess = async () => {
    await queryClient.invalidateQueries({
      queryKey: projectQueries.getBySlug(project.slug).queryKey,
    });
    const updated = queryClient.getQueryData<Project>(
      projectQueries.getBySlug(project.slug).queryKey,
    );
    refreshDocumentFavicon(buildFaviconUrl(getApiUrl(), updated ?? project));
    toast.success(pending?.type === "remove" ? "Favicon removed" : "Favicon updated");
    onSaved();
  };
  const onError = (error: Error) => {
    toast.error(error.message || "Could not save the favicon");
  };
  const upload = useMutation({ ...projectMutations.uploadFavicon(), onSuccess, onError });
  const remove = useMutation({ ...projectMutations.deleteFavicon(), onSuccess, onError });
  const isSaving = upload.isPending || remove.isPending;

  const choose = (file: File) => {
    const error = validateFaviconFile(file);
    if (error) {
      toast.error(error);
      return;
    }
    setPending({ type: "upload", file });
  };

  const save = () => {
    if (pending?.type === "upload") {
      upload.mutate({ projectId: project.id, file: pending.file });
      return;
    }
    if (pending?.type === "remove") remove.mutate({ projectId: project.id });
  };

  const showsFavicon = pending ? pending.type === "upload" : hasCurrent;
  const previewUrl =
    pendingUrl ?? (showsFavicon ? currentUrl : buildFaviconPlaceholderUrl(getApiUrl()));
  const prompt = pendingFile
    ? pendingFile.name
    : showsFavicon
      ? "Drop a new favicon, or click to browse"
      : "Drop your favicon here, or click to browse";

  return (
    <>
      <DialogHeader>
        <DialogTitle>Favicon</DialogTitle>
        <DialogDescription>The icon shown in browser tabs and bookmarks.</DialogDescription>
      </DialogHeader>
      <Alert variant="warning">
        <TriangleAlert />
        <AlertDescription>
          Applies to the whole site, including Live and every draft.
        </AlertDescription>
      </Alert>
      <FaviconDropZone
        previewUrl={previewUrl}
        prompt={prompt}
        disabled={isSaving}
        onFileSelected={choose}
      />
      <DialogFooter>
        {showsFavicon && (
          <Button
            type="button"
            variant="ghost"
            className="sm:mr-auto"
            disabled={isSaving}
            onClick={() => setPending(hasCurrent ? { type: "remove" } : null)}
          >
            <Trash2 />
            Remove favicon
          </Button>
        )}
        <DialogClose render={<Button type="button" variant="outline" disabled={isSaving} />}>
          Cancel
        </DialogClose>
        <Button type="button" onClick={save} disabled={!pending || isSaving}>
          {isSaving && <Spinner />}
          Save
        </Button>
      </DialogFooter>
    </>
  );
}
