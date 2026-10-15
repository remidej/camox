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
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@camox/ui/dialog";
import { Spinner } from "@camox/ui/spinner";
import { toast } from "@camox/ui/toaster";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Trash2 } from "lucide-react";
import * as React from "react";

import type { ApiClient } from "@/lib/api-client";
import { draftMutations, draftQueries, type DraftSummary } from "@/lib/queries";
import { getCurrentDraftId, isDevelopmentMode, switchToLive } from "@/lib/studio-draft";

import { draftLabel, plural, timeAgo } from "../draftLabel";

type Preview = Awaited<ReturnType<ApiClient["drafts"]["previewPublish"]>>;
type Subject = Preview["changes"][number];

const dateFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

/** Where a subject sits: its page or layout, or the files, which belong to neither. */
function ownerName(owner: Subject["owner"], entity: string): string {
  if (!owner) return entity === "file" ? "Files" : "Elsewhere";
  if (owner.kind === "layout") return `Layout ${owner.name}`;
  if (owner.kind === "syncedBlock") return `Synced block ${owner.title}`;
  if (owner.kind === "collection") return owner.title;
  return owner.nickname || owner.path;
}

// The order of change groups: pages first, then layouts, then collections, then files.
const GROUP_ORDER: (NonNullable<Subject["owner"]>["kind"] | "files" | "elsewhere")[] = [
  "page",
  "layout",
  "syncedBlock",
  "collection",
  "files",
  "elsewhere",
];
/**
 * A problem as one line. One with nowhere to find it, like a definition that differs from
 * Live's, names only itself.
 */
function problemLine(problem: Preview["blockers"][number]): string {
  if (!problem.owner && problem.entity !== "file") return `${problem.label}: ${problem.message}`;
  return `${problem.label} on ${ownerName(problem.owner, problem.entity)}: ${problem.message}`;
}

const groupRank = ({ owner, entity }: Subject) =>
  GROUP_ORDER.indexOf(owner?.kind ?? (entity === "file" ? "files" : "elsewhere"));

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
            <li key={`${blocker.code}:${blocker.id}:${blocker.field}`}>{problemLine(blocker)}</li>
          ))}
        </Section>
      )}
      {conflicts.length > 0 && (
        <Section title="Changed on Live since this draft">
          {conflicts.map((conflict) => (
            <li key={conflict.id}>
              {conflict.label} on {ownerName(conflict.owner, conflict.entity)}:{" "}
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
              {change.label} on {ownerName(change.owner, change.entity)}
            </li>
          ))}
        </Section>
      )}
      {warnings.length > 0 && (
        <Section title="Already on Live">
          {warnings.map((warning) => (
            <li key={`${warning.code}:${warning.id}:${warning.field}`}>{problemLine(warning)}</li>
          ))}
        </Section>
      )}
    </div>
  );
}

/** The right column: the draft's changes, grouped by page, then layout, then collection. */
function Changes({ changes }: { changes: Preview["changes"] }) {
  const groups = new Map<string, Preview["changes"]>();
  const sorted = [...changes].sort((a, b) => groupRank(a) - groupRank(b));
  for (const change of sorted) {
    const name = ownerName(change.owner, change.entity);
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
export function useCurrentDraftId() {
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
 * Switches the studio to Live once its draft ended here, replacing the draft's URL entry. A
 * development draft never ends: publishing or discarding empties it, and dev mode stays in it.
 */
export function useLeaveDraft() {
  const queryClient = useQueryClient();
  return (ended: EndedDraft | null) => {
    if (isDevelopmentMode()) {
      void queryClient.invalidateQueries({ queryKey: ["camox"] });
      return;
    }
    switchToLive();
    void queryClient.invalidateQueries({ queryKey: ["camox"] });
    if (ended) toast.success(`Draft ${ended.outcome}. You're now viewing Live.`);
  };
}

/** The draft's name in the review's header, renamed in place by any member (#203). */
function DraftName({ projectId, draft }: { projectId: number; draft: DraftSummary }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = React.useState(false);
  const [value, setValue] = React.useState("");
  const rename = useMutation({
    ...draftMutations.rename(),
    onSuccess: (renamed) => {
      queryClient.setQueryData(draftQueries.get(projectId, draft.id).queryKey, renamed);
      void queryClient.invalidateQueries({ queryKey: draftQueries.list(projectId).queryKey });
    },
    onError: (error) => toast.error(error.message || "Could not rename the draft"),
  });

  if (draft.kind === "development") return <>{draftLabel(draft)}</>;

  if (!editing) {
    return (
      <button
        type="button"
        className="group flex items-center gap-2 text-left"
        onClick={() => {
          setValue(draft.name ?? "");
          setEditing(true);
        }}
      >
        {draftLabel(draft)}
        <Pencil className="text-muted-foreground size-3.5 opacity-0 group-hover:opacity-100" />
      </button>
    );
  }

  const commit = () => {
    setEditing(false);
    if ((value.trim() || null) === draft.name) return;
    rename.mutate({ projectId, name: value });
  };
  return (
    <input
      autoFocus
      aria-label="Draft name"
      value={value}
      placeholder="Name this draft (optional)"
      onChange={(event) => setValue(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit();
        if (event.key !== "Escape") return;
        // Cancels the rename only, not the whole review.
        event.stopPropagation();
        setEditing(false);
      }}
      className="w-full bg-transparent outline-none"
    />
  );
}

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
  const [confirmingDiscard, setConfirmingDiscard] = React.useState(false);
  const preview = useQuery({
    ...draftQueries.previewPublish(projectId, draftId),
    enabled: open,
  });
  const draft = useQuery({ ...draftQueries.get(projectId, draftId), enabled: open });
  const leaveDraft = useLeaveDraft();

  const leave = (ended: EndedDraft | null) => {
    onOpenChange(false);
    leaveDraft(ended);
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

  const data = preview.data;
  const busy = publish.isPending;
  const canPublish = !!data && data.blockers.length === 0 && !busy && !preview.isFetching;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex h-[min(42rem,calc(100dvh-4rem))] flex-col gap-0 p-0 sm:max-w-5xl">
          <div className="border-b p-4 pr-12">
            <DialogTitle>
              {draft.data ? <DraftName projectId={projectId} draft={draft.data} /> : "Draft"}
            </DialogTitle>
            <DialogDescription>
              {draft.data
                ? `${draft.data.createdBy.name} · started ${timeAgo(draft.data.createdAt)} · ${plural(draft.data.changeCount, "change")}`
                : "Publishing applies this whole draft to Live."}
            </DialogDescription>
          </div>
          {data ? (
            <div className="grid min-h-0 flex-1 grid-cols-2 gap-10 px-4">
              <div className="flex min-h-0 flex-col gap-2 overflow-y-auto py-4">
                <h2 className="text-sm font-medium">Before you publish</h2>
                <BeforeYouPublish preview={data} />
              </div>
              <div className="flex min-h-0 flex-col gap-2 overflow-y-auto py-4">
                <h2 className="text-sm font-medium">{plural(data.changes.length, "change")}</h2>
                <Changes changes={data.changes} />
              </div>
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center">
              <Spinner className="text-muted-foreground" />
            </div>
          )}
          <div className="flex items-center gap-2 border-t p-4">
            <Button
              variant="ghost"
              className="text-destructive"
              disabled={busy}
              onClick={() => setConfirmingDiscard(true)}
            >
              <Trash2 />
              Discard draft
            </Button>
            <div className="ml-auto flex items-center gap-3">
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
          </div>
        </DialogContent>
      </Dialog>

      <DiscardDraftDialog
        projectId={projectId}
        open={confirmingDiscard}
        onOpenChange={setConfirmingDiscard}
        onDiscarded={leave}
      />
    </>
  );
}

/** Asks before discarding the draft the studio is in, then discards it. */
export function DiscardDraftDialog({
  projectId,
  open,
  onOpenChange,
  onDiscarded,
}: {
  projectId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDiscarded: (ended: EndedDraft | null) => void;
}) {
  const discard = useMutation({
    ...draftMutations.discard(),
    onSuccess: ({ ended }) => {
      onOpenChange(false);
      onDiscarded(ended);
    },
    onError: (error) => toast.error(error.message || "Could not discard the draft"),
  });

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!discard.isPending) onOpenChange(next);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Discard this draft?</AlertDialogTitle>
          <AlertDialogDescription>
            Every change in this draft is deleted for everyone. Live stays as it is. This can't be
            undone.
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
  );
}
