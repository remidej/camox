import { Button } from "@camox/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@camox/ui/dialog";
import { Input } from "@camox/ui/input";
import { Spinner } from "@camox/ui/spinner";
import { toast } from "@camox/ui/toaster";
import { useMutation } from "@tanstack/react-query";
import * as React from "react";

import { getDraftReadClient } from "@/lib/api-client";
import type { DraftSummary } from "@/lib/queries";

import { reads, useStudioCache } from "../../../lib/studio-reads";

/**
 * Renames a regular draft, whichever draft the studio views: the request names the draft it
 * renames. A blank name clears it, so the draft shows its computed label again.
 */
export function useRenameDraft(projectId: number) {
  const studioCache = useStudioCache();
  return useMutation({
    mutationFn: ({ draftId, name }: { draftId: string; name: string }) =>
      getDraftReadClient(draftId).drafts.rename({ projectId, name }),
    onSuccess: (renamed) => {
      studioCache.set(reads.draft({ projectId, draftId: renamed.id }), renamed);
      void studioCache.invalidate(reads.draftList({ projectId }));
    },
    onError: (error) => toast.error(error.message || "Could not rename the draft"),
  });
}

/** Asks for a draft's new name, starting from its current name, selected to type over. */
export function RenameDraftDialog({
  projectId,
  draft,
  onOpenChange,
}: {
  projectId: number;
  /** The draft to rename, or null when the dialog is closed. */
  draft: DraftSummary | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={!!draft} onOpenChange={onOpenChange}>
      {draft && (
        <RenameDraftForm
          key={draft.id}
          projectId={projectId}
          draft={draft}
          onDone={() => onOpenChange(false)}
        />
      )}
    </Dialog>
  );
}

function RenameDraftForm({
  projectId,
  draft,
  onDone,
}: {
  projectId: number;
  draft: DraftSummary;
  onDone: () => void;
}) {
  const [value, setValue] = React.useState(draft.name ?? "");
  const input = React.useRef<HTMLInputElement>(null);
  const rename = useRenameDraft(projectId);

  const submit = () => {
    if ((value.trim() || null) === draft.name) return onDone();
    rename.mutate({ draftId: draft.id, name: value }, { onSuccess: onDone });
  };

  return (
    <DialogContent initialFocus={input}>
      <DialogHeader>
        <DialogTitle>Rename draft</DialogTitle>
      </DialogHeader>
      <form
        className="grid gap-6"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Input
          ref={input}
          aria-label="Draft name"
          value={value}
          placeholder="Name this draft (optional)"
          maxLength={200}
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => setValue(event.target.value)}
        />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" disabled={rename.isPending}>
            {rename.isPending && <Spinner />}
            Rename
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
