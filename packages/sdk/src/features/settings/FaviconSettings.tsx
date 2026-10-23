import { Button } from "@camox/ui/button";
import { FaviconDropZone, validateFaviconFile } from "@camox/ui/favicon-drop-zone";
import { Spinner } from "@camox/ui/spinner";
import { toast } from "@camox/ui/toaster";
import { useMutation } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import * as React from "react";

import { buildDefaultFaviconUrl, buildFaviconUrl } from "@/features/routes/pageRuntime";
import { getApiUrl } from "@/lib/api-client";
import { type Project, projectMutations } from "@/lib/queries";

import { reads, useStudioCache } from "../../lib/studio-reads";
import { SettingsPart } from "./SettingsPart";

type PendingChange = { type: "upload"; file: File } | { type: "remove" } | null;

/** Points the studio tab's own icon at the saved favicon, so the change shows without a reload. */
function refreshDocumentFavicon(href: string) {
  for (const link of document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]')) {
    link.href = href;
  }
}

export function FaviconSettings({ project }: { project: Project }) {
  const studioCache = useStudioCache();
  const [pending, setPending] = React.useState<PendingChange>(null);
  const [hasCurrent, setHasCurrent] = React.useState(false);
  const currentUrl = buildFaviconUrl(getApiUrl(), project, { withDefault: false });

  // Without the default the current favicon 404s when none was uploaded, which tells us
  // whether there is one to show and remove. Re-probes after each save, which bumps the URL.
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
    await studioCache.invalidate(reads.project({ projectUuid: project.uuid }));
    const updated = studioCache.get(reads.project({ projectUuid: project.uuid }));
    refreshDocumentFavicon(buildFaviconUrl(getApiUrl(), updated ?? project));
    toast.success(pending?.type === "remove" ? "Favicon removed" : "Favicon updated");
    setPending(null);
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
    pendingUrl ?? (showsFavicon ? currentUrl : buildDefaultFaviconUrl(getApiUrl()));
  const prompt = pendingFile
    ? pendingFile.name
    : showsFavicon
      ? "Drop a new favicon, or click to browse"
      : "Drop your favicon here, or click to browse";

  return (
    <SettingsPart title="Favicon" description="The icon shown in browser tabs and bookmarks.">
      <div className="flex flex-col gap-4">
        <FaviconDropZone
          previewUrl={previewUrl}
          prompt={prompt}
          disabled={isSaving}
          onFileSelected={choose}
        />
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={save} disabled={!pending || isSaving}>
            {isSaving && <Spinner />}
            Save
          </Button>
          {pending && (
            <Button
              type="button"
              variant="outline"
              disabled={isSaving}
              onClick={() => setPending(null)}
            >
              Cancel
            </Button>
          )}
          {showsFavicon && (
            <Button
              type="button"
              variant="ghost"
              className="ml-auto"
              disabled={isSaving}
              onClick={() => setPending(hasCurrent ? { type: "remove" } : null)}
            >
              <Trash2 />
              Remove favicon
            </Button>
          )}
        </div>
      </div>
    </SettingsPart>
  );
}
