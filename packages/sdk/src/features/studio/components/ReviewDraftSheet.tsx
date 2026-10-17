import type { PublishPreview } from "@camox/api-contract";
import { CONFLICTS_CHANGED_ERROR, type EndedDraft } from "@camox/api-contract/drafts";
import {
  Accordion,
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  AccordionTrigger,
} from "@camox/ui/accordion";
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
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@camox/ui/sheet";
import { Spinner } from "@camox/ui/spinner";
import { toast } from "@camox/ui/toaster";
import { useMutation } from "@tanstack/react-query";
import {
  Blocks,
  ChevronRight,
  CircleCheck,
  Database,
  FileText,
  History,
  Image,
  Info,
  type LucideIcon,
  OctagonX,
  PanelsTopLeft,
  Pencil,
  Shapes,
  Trash2,
  TriangleAlert,
  Unlink,
} from "lucide-react";
import * as React from "react";

import { useDraftScope } from "@/lib/draft-scope";
import { draftMutations, type DraftSummary } from "@/lib/queries";
import { cn } from "@/lib/utils";

import { reads, useReadQuery, useStudioCache } from "../../../lib/studio-reads";
import { draftLabel, plural, timeAgo } from "../draftLabel";

type Subject = PublishPreview["changes"][number];
type Change = Subject["change"];
type GroupKind = NonNullable<Subject["owner"]>["kind"] | "files" | "elsewhere";

const dateFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

/** Where a subject sits: its page or layout, or the files, which belong to neither. */
function ownerName(owner: Subject["owner"], entity: Subject["entity"]): string {
  if (!owner) return entity === "file" ? "Files" : "Elsewhere";
  if (owner.kind === "layout") return `Layout ${owner.name}`;
  if (owner.kind === "syncedBlock") return `Synced block ${owner.title}`;
  if (owner.kind === "collection") return owner.title;
  return owner.nickname || owner.path;
}

/**
 * Where to find a problem. One with nowhere to find it, like a definition that differs from
 * Live's, names only itself.
 */
function problemPlace(problem: PublishPreview["blockers"][number]): string | null {
  if (!problem.owner && problem.entity !== "file") return null;
  return ownerName(problem.owner, problem.entity);
}

const groupKind = ({ owner, entity }: Subject): GroupKind =>
  owner?.kind ?? (entity === "file" ? "files" : "elsewhere");

// The order of change groups: pages first, then layouts, then collections, then files.
const GROUPS: Record<GroupKind, { rank: number; icon: LucideIcon }> = {
  page: { rank: 0, icon: FileText },
  layout: { rank: 1, icon: PanelsTopLeft },
  syncedBlock: { rank: 2, icon: Blocks },
  collection: { rank: 3, icon: Database },
  files: { rank: 4, icon: Image },
  elsewhere: { rank: 5, icon: Shapes },
};

const CHANGES: Record<Change, { sign: string; className: string }> = {
  created: { sign: "+", className: "text-green-600 dark:text-green-400" },
  changed: { sign: "~", className: "text-muted-foreground" },
  deleted: { sign: "−", className: "text-destructive" },
};

type Tone = "danger" | "warning" | "success" | "neutral";

const TONES: Record<Tone, { card: string; icon: string }> = {
  danger: {
    card: "border-destructive/30 bg-destructive/5",
    icon: "bg-destructive/10 text-destructive",
  },
  warning: {
    card: "border-amber-500/30 bg-amber-500/5",
    icon: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  },
  success: {
    card: "border-green-500/30 bg-green-500/5",
    icon: "bg-green-500/15 text-green-600 dark:text-green-400",
  },
  neutral: { card: "bg-muted/40", icon: "bg-muted text-muted-foreground" },
};

/** Who made Live's version of a conflicting entity: a member, a release, or nobody known. */
function changedBy(conflict: PublishPreview["conflicts"][number]) {
  if (conflict.release) return " by a release";
  if (conflict.publishedBy) return ` by ${conflict.publishedBy.name}`;
  return "";
}

const LOST_REASONS: Record<PublishPreview["lost"][number]["reason"], string> = {
  parentGone: "What it belongs to is gone from Live and from this draft, so it's dropped.",
  writtenAfterDeletion: "This draft deletes what it was added to, so it goes too.",
};

/** The verdict at the top of the review: can this draft go to Live, and is there a catch? */
function Verdict({ preview }: { preview: PublishPreview }) {
  const { blockers, conflicts, lost } = preview;
  const catches = conflicts.length + lost.length;
  const [tone, Icon, title, description]: [Tone, LucideIcon, string, string] = blockers.length
    ? [
        "danger",
        OctagonX,
        "Not ready to publish",
        `Fix ${blockers.length === 1 ? "this problem" : `these ${blockers.length} problems`} in the draft first.`,
      ]
    : catches
      ? [
          "warning",
          TriangleAlert,
          `Ready, with ${plural(catches, "thing")} to know`,
          "Publishing replaces Live's version wherever the two differ.",
        ]
      : [
          "success",
          CircleCheck,
          "Ready to publish",
          "Nothing on Live changed since this draft did.",
        ];

  return (
    <div className={cn("flex gap-3 rounded-xl border p-4", TONES[tone].card)}>
      <span
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-lg",
          TONES[tone].icon,
        )}
      >
        <Icon className="size-5" />
      </span>
      <div className="flex flex-col gap-0.5">
        <p className="font-medium">{title}</p>
        <p className="text-foreground/70 text-sm">{description}</p>
      </div>
    </div>
  );
}

const INSIGHT_LIST = "bg-background divide-y overflow-hidden rounded-lg border";

function Insight({
  tone,
  icon: Icon,
  title,
  hint,
  count,
  children,
}: {
  tone: Tone;
  icon: LucideIcon;
  title: string;
  hint: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded-md",
            TONES[tone].icon,
          )}
        >
          <Icon className="size-3.5" />
        </span>
        <h3 className="text-sm font-medium">{title}</h3>
        <span className="text-muted-foreground bg-muted rounded-full px-1.5 text-xs tabular-nums">
          {count}
        </span>
      </div>
      <p className="text-muted-foreground text-xs">{hint}</p>
      <ul className={INSIGHT_LIST}>{children}</ul>
    </section>
  );
}

function InsightItem({
  label,
  place,
  detail,
}: {
  label: string;
  place: string | null;
  detail: React.ReactNode;
}) {
  return (
    <li className="flex flex-col gap-0.5 px-3 py-2.5">
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="truncate text-sm font-medium">{label}</span>
        {place && <span className="text-muted-foreground truncate text-xs">{place}</span>}
      </div>
      <p className="text-muted-foreground text-sm">{detail}</p>
    </li>
  );
}

type Problem = PublishPreview["blockers"][number];

/** From how many problems sharing a message they read as one item, naming each subject. */
const SHARED_MESSAGE_MIN = 3;

/**
 * Problems, with those sharing a message folded into one item: a draft can hold dozens of
 * definitions to release, and the message is the same for each.
 */
function ProblemItems({ problems }: { problems: Problem[] }) {
  const byMessage = new Map<string, Problem[]>();
  for (const problem of problems) {
    byMessage.set(problem.message, [...(byMessage.get(problem.message) ?? []), problem]);
  }
  return [...byMessage].flatMap(([message, shared]) => {
    if (shared.length < SHARED_MESSAGE_MIN) {
      return shared.map((problem) => (
        <InsightItem
          key={`${problem.code}:${problem.id}:${problem.field}`}
          label={problem.label}
          place={problemPlace(problem)}
          detail={problem.message}
        />
      ));
    }
    return [
      <li key={`shared:${message}`} className="flex flex-col gap-2 px-3 py-2.5">
        <p className="text-sm font-medium">{message}</p>
        <ul className="flex flex-wrap gap-1">
          {shared.map((problem) => {
            const place = problemPlace(problem);
            return (
              <li
                key={`${problem.code}:${problem.id}:${problem.field}`}
                className="bg-muted text-muted-foreground rounded-md px-1.5 py-0.5 text-xs"
              >
                <span className="text-foreground">{problem.label}</span>
                {place && ` · ${place}`}
              </li>
            );
          })}
        </ul>
      </li>,
    ];
  });
}

/** What publishing will do, in the order ADR 0009 lists it. */
function Insights({ preview }: { preview: PublishPreview }) {
  const { blockers, conflicts, lost, warnings } = preview;
  return (
    <>
      {/* The verdict above already heads the blockers. */}
      {blockers.length > 0 && (
        <ul className={INSIGHT_LIST}>
          <ProblemItems problems={blockers} />
        </ul>
      )}
      {conflicts.length > 0 && (
        <Insight
          tone="warning"
          icon={History}
          title="Changed on Live since this draft"
          hint="This draft's version replaces Live's. Check nothing important gets overwritten."
          count={conflicts.length}
        >
          {conflicts.map((conflict) => (
            <InsightItem
              key={conflict.id}
              label={conflict.label}
              place={ownerName(conflict.owner, conflict.entity)}
              detail={
                <>
                  {conflict.liveVersion === null ? "Deleted" : "Changed"}
                  {changedBy(conflict)}
                  {conflict.publishedAt ? `, ${dateFormat.format(conflict.publishedAt)}` : ""}
                </>
              }
            />
          ))}
        </Insight>
      )}
      {lost.length > 0 && (
        <Insight
          tone="warning"
          icon={Unlink}
          title="Changes that will be lost"
          hint="These can't be kept, and can't be brought back after publishing."
          count={lost.length}
        >
          {lost.map((change) => (
            <InsightItem
              key={change.id}
              label={change.label}
              place={ownerName(change.owner, change.entity)}
              detail={LOST_REASONS[change.reason]}
            />
          ))}
        </Insight>
      )}
      {warnings.length > 0 && (
        <Insight
          tone="neutral"
          icon={Info}
          title="Already on Live"
          hint="These don't block publishing, but are worth fixing."
          count={warnings.length}
        >
          <ProblemItems problems={warnings} />
        </Insight>
      )}
    </>
  );
}

/**
 * The draft's changes, grouped by page, then layout, then collection. Collapsed at first: the
 * insights above are what to read before publishing.
 */
function Changes({ changes }: { changes: PublishPreview["changes"] }) {
  const groups = new Map<string, { kind: GroupKind; changes: PublishPreview["changes"] }>();
  const sorted = [...changes].sort((a, b) => GROUPS[groupKind(a)].rank - GROUPS[groupKind(b)].rank);
  for (const change of sorted) {
    const name = ownerName(change.owner, change.entity);
    const group = groups.get(name) ?? { kind: groupKind(change), changes: [] };
    group.changes.push(change);
    groups.set(name, group);
  }

  if (groups.size === 0) {
    return <p className="text-muted-foreground text-sm">This draft has no changes.</p>;
  }

  const counts = (Object.keys(CHANGES) as Change[])
    .map((kind) => [kind, changes.filter((change) => change.change === kind).length] as const)
    .filter(([, count]) => count > 0);

  return (
    <Accordion className="rounded-lg border">
      <AccordionItem>
        <AccordionHeader>
          <AccordionTrigger className="group hover:bg-muted/50 flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left">
            <ChevronRight className="text-muted-foreground size-4 shrink-0 transition-transform group-data-panel-open:rotate-90" />
            <span className="text-sm font-medium">{plural(changes.length, "change")}</span>
            <span className="text-muted-foreground text-sm">in {plural(groups.size, "place")}</span>
            <span className="ml-auto flex items-center gap-2 text-xs tabular-nums">
              {counts.map(([kind, count]) => (
                <span key={kind} title={`${count} ${kind}`} className={CHANGES[kind].className}>
                  {CHANGES[kind].sign}
                  {count}
                </span>
              ))}
            </span>
          </AccordionTrigger>
        </AccordionHeader>
        <AccordionPanel>
          <div className="flex flex-col gap-4 border-t px-3 py-3">
            {[...groups].map(([name, group]) => {
              const Icon = GROUPS[group.kind].icon;
              return (
                <section key={name} className="flex flex-col gap-1">
                  <h4 className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
                    <Icon className="size-3.5" />
                    {name}
                  </h4>
                  <ul className="flex flex-col">
                    {group.changes.map((change) => (
                      <li
                        key={change.id}
                        className="flex items-center gap-2 py-0.5 pl-5 text-sm"
                        title={change.change}
                      >
                        <span
                          aria-hidden
                          className={cn(
                            "w-2 text-center font-mono",
                            CHANGES[change.change].className,
                          )}
                        >
                          {CHANGES[change.change].sign}
                        </span>
                        <span className="truncate" data-change-label>
                          {change.label}
                        </span>
                        <span className="sr-only">({change.change})</span>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        </AccordionPanel>
      </AccordionItem>
    </Accordion>
  );
}

/**
 * Switches the studio to Live once its draft ended here, replacing the draft's URL entry. A
 * development draft never ends: publishing or discarding empties it, and dev mode stays in it.
 */
export function useLeaveDraft() {
  const draftScope = useDraftScope();
  return (ended: EndedDraft | null) => {
    const left = draftScope.leave(ended);
    if (left && ended) toast.success(`Draft ${ended.outcome}. You're now viewing Live.`);
  };
}

/**
 * The draft's name in the review's header, renamed in place by any member (#203). It starts in
 * edit mode when the review was opened to rename the draft.
 */
function DraftName({
  projectId,
  draft,
  startRenaming,
}: {
  projectId: number;
  draft: DraftSummary;
  startRenaming: boolean;
}) {
  const studioCache = useStudioCache();
  const [editing, setEditing] = React.useState(startRenaming);
  const [value, setValue] = React.useState(draft.name ?? "");
  const rename = useMutation({
    ...draftMutations.rename(),
    onSuccess: (renamed) => {
      studioCache.set(reads.draft({ projectId, draftId: draft.id }), renamed);
      void studioCache.invalidate(reads.draftList({ projectId }));
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
export function ReviewDraftSheet({
  projectId,
  draftId,
  open,
  startRenaming = false,
  onOpenChange,
}: {
  projectId: number;
  draftId: string;
  open: boolean;
  /** Opens with the draft's name being edited, as if the member had clicked it. */
  startRenaming?: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [confirmingDiscard, setConfirmingDiscard] = React.useState(false);
  const preview = useReadQuery(reads.publishPreview({ projectId, draftId }), { enabled: open });
  const draft = useReadQuery(reads.draft({ projectId, draftId }), { enabled: open });
  const leaveDraft = useLeaveDraft();

  const leave = (ended: EndedDraft | null) => {
    onOpenChange(false);
    leaveDraft(ended);
  };

  const publish = useMutation({
    ...draftMutations.publish(),
    onSuccess: ({ empty, ended }) => {
      if (!empty) return leave(ended);
      toast.info("This draft has no changes, so there is nothing to publish.");
      void preview.refetch();
    },
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
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-full gap-0 data-[side=right]:sm:max-w-lg">
          <div className="flex flex-col gap-1 border-b p-4 pr-12">
            <SheetTitle className="text-base">
              {draft.data ? (
                <DraftName projectId={projectId} draft={draft.data} startRenaming={startRenaming} />
              ) : (
                "Draft"
              )}
            </SheetTitle>
            <SheetDescription>
              {draft.data
                ? `${draft.data.createdBy.name} · started ${timeAgo(draft.data.createdAt)}`
                : "Publishing applies this whole draft to Live."}
            </SheetDescription>
          </div>
          {data ? (
            <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-4">
              <Verdict preview={data} />
              <Insights preview={data} />
              <Changes changes={data.changes} />
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center">
              <Spinner className="text-muted-foreground" />
            </div>
          )}
          <div className="flex flex-col gap-3 border-t p-4">
            {data && data.conflicts.length > 0 && (
              <p className="text-muted-foreground text-sm">
                {plural(data.conflicts.length, "Live change")} will be overwritten
              </p>
            )}
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                className="text-destructive"
                disabled={busy}
                onClick={() => setConfirmingDiscard(true)}
              >
                <Trash2 />
                Discard draft
              </Button>
              <Button
                className="ml-auto"
                disabled={!canPublish}
                onClick={() => data && publish.mutate({ projectId, token: data.token })}
              >
                {publish.isPending ? <Spinner /> : null}
                Publish all
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

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
