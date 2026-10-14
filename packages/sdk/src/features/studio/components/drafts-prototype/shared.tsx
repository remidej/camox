/** PROTOTYPE (#203), throwaway. Bits every variant reuses; layouts stay per variant. */
import { toast } from "@camox/ui/toaster";
import { useSelector } from "@xstate/store-react";
import {
  AlertTriangle,
  Bot,
  File,
  FileText,
  Image,
  LayoutTemplate,
  Link2Off,
  Minus,
  PanelTop,
  Plus,
  Repeat2,
  SquarePen,
  XCircle,
} from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

import {
  type Change,
  type Conflict,
  type Draft,
  type Lost,
  draftLabel,
  draftsStore,
  getBlockers,
  timeAgo,
} from "./store";

/** The prototype's own Toaster, since the runtime preview mounts none. */
export const TOASTER_ID = "drafts-prototype";

export function useDrafts() {
  const context = useSelector(draftsStore, (state) => state.context);
  const draft = context.drafts.find((d) => d.id === context.current) ?? null;
  return { ...context, draft };
}

/**
 * The publish flow: conflicts are computed when the confirmation opens, and
 * the batch aborts if Live changed since, showing the new conflicts instead.
 */
export function usePublish(draft: Draft | null) {
  const [open, setOpen] = React.useState(false);
  const [shownConflicts, setShownConflicts] = React.useState<Conflict[]>([]);
  const [staleNotice, setStaleNotice] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  const blockers = draft ? getBlockers(draft) : [];

  const openReview = () => {
    if (!draft) return;
    setShownConflicts(draft.conflicts);
    setStaleNotice(null);
    setOpen(true);
  };

  const publish = () => {
    if (!draft || blockers.length > 0) return;
    setPending(true);
    window.setTimeout(() => {
      setPending(false);
      const current = draftsStore.getSnapshot().context.drafts.find((d) => d.id === draft.id);
      if (current && current.conflicts.length !== shownConflicts.length) {
        const added = current.conflicts.length - shownConflicts.length;
        setShownConflicts(current.conflicts);
        setStaleNotice(
          `Live changed while you were reviewing: ${added} new conflict${added === 1 ? "" : "s"}. Nothing was published.`,
        );
        return;
      }
      draftsStore.send({ type: "end", id: draft.id, published: true });
      setOpen(false);
      toast.success(`Published “${draftLabel(draft)}”`, {
        toasterId: TOASTER_ID,
        description: draft.development
          ? "Your development draft is empty again."
          : "The draft is closed. You're viewing Live.",
      });
    }, 900);
  };

  return {
    open,
    setOpen: (next: boolean) => !pending && setOpen(next),
    openReview,
    publish,
    pending,
    blockers,
    conflicts: shownConflicts,
    staleNotice,
  };
}

export function discard(draft: Draft) {
  draftsStore.send({ type: "end", id: draft.id, published: false });
  toast(`Discarded “${draftLabel(draft)}”`, {
    toasterId: TOASTER_ID,
    description: draft.development ? "Your development draft is empty again." : undefined,
  });
}

export function CreatorLine({ draft, className }: { draft: Draft; className?: string }) {
  return (
    <span className={cn("text-muted-foreground inline-flex items-center gap-1 text-xs", className)}>
      {draft.creator.kind === "agent" && <Bot className="size-3" />}
      {draft.creator.name} · started {timeAgo(draft.createdAt)} · {draft.changes.length} change
      {draft.changes.length === 1 ? "" : "s"}
    </span>
  );
}

const entityIcons: Record<Change["entity"], React.ElementType> = {
  page: FileText,
  block: PanelTop,
  layout: LayoutTemplate,
  "synced block": Repeat2,
  record: File,
  file: Image,
};

const kindIcons = { added: Plus, changed: SquarePen, deleted: Minus };
const kindColors = {
  added: "text-green-600 dark:text-green-400",
  changed: "text-blue-600 dark:text-blue-400",
  deleted: "text-red-600 dark:text-red-400",
};

export function ChangeRow({ change }: { change: Change }) {
  const EntityIcon = entityIcons[change.entity];
  const KindIcon = kindIcons[change.kind];
  return (
    <li className="flex flex-col gap-0.5 py-1">
      <div className="flex items-center gap-2 text-sm">
        <KindIcon className={cn("size-3.5 shrink-0", kindColors[change.kind])} />
        <EntityIcon className="text-muted-foreground size-3.5 shrink-0" />
        <span className={cn("truncate", change.kind === "deleted" && "line-through")}>
          {change.label}
        </span>
        <span className="text-muted-foreground ml-auto shrink-0 text-xs">{change.entity}</span>
      </div>
      {change.dangling && (
        <span className="ml-11 flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
          <Link2Off className="size-3" />
          {change.dangling}; it will read as empty
        </span>
      )}
    </li>
  );
}

export function ConflictRow({ conflict }: { conflict: Conflict }) {
  return (
    <li className="flex items-start gap-2 py-1 text-sm">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
      <span>
        <span className="font-medium">{conflict.label}</span>
        <span className="text-muted-foreground">
          {" "}
          — {conflict.publishedBy} published it {timeAgo(conflict.publishedAt)}. Their version will
          be overwritten.
        </span>
      </span>
    </li>
  );
}

export function LostRow({ lost }: { lost: Lost }) {
  return (
    <li className="flex items-start gap-2 py-1 text-sm">
      <Minus className="mt-0.5 size-3.5 shrink-0 text-red-600" />
      <span>
        <span className="font-medium">{lost.label}</span>
        <span className="text-muted-foreground"> — {lost.reason}</span>
      </span>
    </li>
  );
}

export function BlockerRow({ blocker }: { blocker: string }) {
  return (
    <li className="text-destructive flex items-start gap-2 py-1 text-sm">
      <XCircle className="mt-0.5 size-3.5 shrink-0" />
      <span>{blocker}</span>
    </li>
  );
}
