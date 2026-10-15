import { CONFLICTS_CHANGED_ERROR, type EndedDraft } from "@camox/api-contract/drafts";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@camox/ui/dialog";
import { Spinner } from "@camox/ui/spinner";
import { toast } from "@camox/ui/toaster";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";

import type { ApiClient } from "@/lib/api-client";
import { AuthContext } from "@/lib/auth";
import { draftMutations, draftQueries, projectQueries } from "@/lib/queries";
import { getCurrentDraftId, switchToLive } from "@/lib/studio-draft";

type Preview = Awaited<ReturnType<ApiClient["drafts"]["previewPublish"]>>;
type Subject = Preview["changes"][number];

const dateFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

function ownerName(owner: Subject["owner"]): string {
  if (!owner) return "Elsewhere";
  if (owner.kind === "layout") return `Layout ${owner.name}`;
  if (owner.kind === "collection") return owner.title;
  return owner.nickname || owner.path;
}

// The order of change groups: pages first, then layouts, then collections.
const GROUP_ORDER: (NonNullable<Subject["owner"]>["kind"] | "elsewhere")[] = [
  "page",
  "layout",
  "collection",
  "elsewhere",
];
const groupRank = (owner: Subject["owner"]) => GROUP_ORDER.indexOf(owner?.kind ?? "elsewhere");

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1">
      <h3 className="text-sm font-medium">{title}</h3>
      <ul className="text-muted-foreground flex flex-col gap-1 text-sm">{children}</ul>
    </section>
  );
}

/** Who made Live's version of a conflicting entity: a member, a release, or nobody known. */
function changedBy(conflict: Preview["conflicts"][number]) {
  if (conflict.release) return " by a release";
  if (conflict.publishedBy) return ` by ${conflict.publishedBy.name}`;
  return "";
}

/** The left column: what publishing will do, in the order ADR 0009 lists it. */
function BeforeYouPublish({ preview }: { preview: Preview }) {
  const { blockers, conflicts, lost, warnings } = preview;
  if (!blockers.length && !conflicts.length && !lost.length && !warnings.length) {
    return (
      <p className="text-muted-foreground text-sm">Nothing on Live changed since this draft did.</p>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {blockers.length > 0 && (
        <Section title="Fix before publishing">
          {blockers.map((blocker) => (
            <li key={`${blocker.id}:${blocker.field}`}>
              {blocker.label} on {ownerName(blocker.owner)}: {blocker.message}
            </li>
          ))}
        </Section>
      )}
      {conflicts.length > 0 && (
        <Section title="Changed on Live since this draft">
          {conflicts.map((conflict) => (
            <li key={conflict.id}>
              {conflict.label} on {ownerName(conflict.owner)}:{" "}
              {conflict.liveVersion === null ? "deleted" : "changed"}
              {changedBy(conflict)}
              {conflict.publishedAt ? `, ${dateFormat.format(conflict.publishedAt)}` : ""}
            </li>
          ))}
        </Section>
      )}
      {lost.length > 0 && (
        <Section title="Changes that will be lost">
          {lost.map((change) => (
            <li key={change.id}>
              {change.label} on {ownerName(change.owner)}
            </li>
          ))}
        </Section>
      )}
      {warnings.length > 0 && (
        <Section title="Already on Live">
          {warnings.map((warning) => (
            <li key={`${warning.id}:${warning.field}`}>
              {warning.label} on {ownerName(warning.owner)}: {warning.message}
            </li>
          ))}
        </Section>
      )}
    </div>
  );
}

/** The right column: the draft's changes, grouped by page, then layout, then collection. */
function Changes({ changes }: { changes: Preview["changes"] }) {
  const groups = new Map<string, Preview["changes"]>();
  const sorted = [...changes].sort((a, b) => groupRank(a.owner) - groupRank(b.owner));
  for (const change of sorted) {
    const name = ownerName(change.owner);
    groups.set(name, [...(groups.get(name) ?? []), change]);
  }
  if (groups.size === 0) {
    return <p className="text-muted-foreground text-sm">This draft has no changes.</p>;
  }
  return (
    <div className="flex flex-col gap-4">
      {[...groups].map(([name, grouped]) => (
        <Section key={name} title={name}>
          {grouped.map((change) => (
            <li key={change.id}>
              {change.label} <span className="text-xs">({change.change})</span>
            </li>
          ))}
        </Section>
      ))}
    </div>
  );
}

/** The draft the studio is in, following switches that the studio's navigation announces. */
function useCurrentDraftId() {
  return React.useSyncExternalStore(
    (onChange) => {
      window.addEventListener("camox:navigation", onChange);
      window.addEventListener("popstate", onChange);
      return () => {
        window.removeEventListener("camox:navigation", onChange);
        window.removeEventListener("popstate", onChange);
      };
    },
    getCurrentDraftId,
    () => null,
  );
}

/**
 * Opens the review of the draft the studio is in. Shown only in a draft; the full drafts
 * control replaces it (#203).
 */
export function ReviewDraftButton() {
  const draftId = useCurrentDraftId();
  const [open, setOpen] = React.useState(false);
  const authCtx = React.useContext(AuthContext);
  const project = useQuery({
    ...projectQueries.getBySlug(authCtx?.projectSlug ?? ""),
    enabled: !!authCtx?.projectSlug && !!draftId,
  });
  if (!draftId || !project.data) return null;
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        Review and publish
      </Button>
      <ReviewDraftDialog
        projectId={project.data.id}
        draftId={draftId}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/**
 * Reviews a draft before publishing it whole, or discards it (ADR 0009). Publishing sends back
 * the token of the preview shown; when Live changed since, nothing is published and the new
 * preview is shown. Once the draft ends, the studio switches to Live.
 */
export function ReviewDraftDialog({
  projectId,
  draftId,
  open,
  onOpenChange,
}: {
  projectId: number;
  draftId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [confirmingDiscard, setConfirmingDiscard] = React.useState(false);
  const preview = useQuery({
    ...draftQueries.previewPublish(projectId, draftId),
    enabled: open,
  });

  const leave = (ended: EndedDraft | null) => {
    setConfirmingDiscard(false);
    onOpenChange(false);
    switchToLive();
    void queryClient.invalidateQueries({ queryKey: ["camox"] });
    if (ended) toast.success(`Draft ${ended.outcome}. You're now viewing Live.`);
  };

  const publish = useMutation({
    ...draftMutations.publish(),
    onSuccess: ({ ended }) => leave(ended),
    onError: (error) => {
      if ((error as { code?: string }).code === CONFLICTS_CHANGED_ERROR) {
        toast.error("Live changed since you opened this review. Check the new list.");
        void preview.refetch();
        return;
      }
      toast.error(error.message || "Could not publish the draft");
      void preview.refetch();
    },
  });
  const discard = useMutation({
    ...draftMutations.discard(),
    onSuccess: ({ ended }) => leave(ended),
    onError: (error) => toast.error(error.message || "Could not discard the draft"),
  });

  const data = preview.data;
  const busy = publish.isPending || discard.isPending;
  const canPublish = !!data && data.blockers.length === 0 && !busy && !preview.isFetching;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Review and publish</DialogTitle>
            <DialogDescription>Publishing applies this whole draft to Live.</DialogDescription>
          </DialogHeader>
          {data ? (
            <div className="grid grid-cols-2 gap-8">
              <div className="flex flex-col gap-2">
                <h2 className="font-medium">Before you publish</h2>
                <BeforeYouPublish preview={data} />
              </div>
              <div className="flex flex-col gap-2">
                <h2 className="font-medium">Changes</h2>
                <Changes changes={data.changes} />
              </div>
            </div>
          ) : (
            <Spinner className="text-muted-foreground" />
          )}
          <DialogFooter className="items-center sm:justify-between">
            <Button variant="outline" disabled={busy} onClick={() => setConfirmingDiscard(true)}>
              Discard draft
            </Button>
            <div className="flex items-center gap-3">
              {data && data.conflicts.length > 0 && (
                <span className="text-muted-foreground text-sm">
                  {plural(data.conflicts.length, "Live change")} will be overwritten
                </span>
              )}
              <Button
                disabled={!canPublish}
                onClick={() => data && publish.mutate({ projectId, token: data.token })}
              >
                {publish.isPending ? <Spinner /> : null}
                Publish all
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={confirmingDiscard}
        onOpenChange={(next) => {
          if (!discard.isPending) setConfirmingDiscard(next);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard this draft?</AlertDialogTitle>
            <AlertDialogDescription>
              Every change in this draft is deleted. Live stays as it is. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel variant="outline" size="default" disabled={discard.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={discard.isPending}
              onClick={() => discard.mutate({ projectId })}
            >
              {discard.isPending ? <Spinner /> : null}
              Discard draft
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
