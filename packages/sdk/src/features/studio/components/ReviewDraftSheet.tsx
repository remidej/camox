import {
  CHECKS_RUNNING_ERROR,
  CONFLICTS_CHANGED_ERROR,
  type EndedDraft,
  FINDINGS_OPEN_ERROR,
  REVISION_CHANGED_ERROR,
  TRANSLATIONS_PENDING_ERROR,
} from "@camox/api-contract/drafts";
import type { PublishPreview } from "@camox/api-contract/router";
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
import { Skeleton } from "@camox/ui/skeleton";
import { Spinner } from "@camox/ui/spinner";
import { toast } from "@camox/ui/toaster";
import { useMutation } from "@tanstack/react-query";
import {
  CircleAlert,
  CircleCheck,
  type LucideIcon,
  OctagonX,
  Replace,
  Trash2,
  TriangleAlert,
  Unlink,
} from "lucide-react";
import * as React from "react";

import { draftMutations, patrolMutations } from "@/lib/queries";
import { cn } from "@/lib/utils";

import { reads, useReadQuery } from "../../../lib/studio-reads";
import { previewStore } from "../../preview/previewStore";
import { draftLabel, plural, timeAgo } from "../draftLabel";
import { askAgentMessage, findingSentence, fixLabel } from "../findingSentence";
import { localeLabel } from "../localeOptions";
import { type CanvasTarget, useShowInCanvas } from "../showInCanvas";
import { studioStore } from "../studioStore";
import { useLeaveDraft } from "../viewSwitch";

type Subject = PublishPreview["changes"][number];
type Problem = PublishPreview["blockers"][number];
type Conflict = PublishPreview["conflicts"][number];
type Lost = PublishPreview["lost"][number];
type Finding = PublishPreview["findings"][number];

const dateFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const listFormat = new Intl.ListFormat("en", { style: "long", type: "conjunction" });

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
function problemPlace(problem: Problem): string | null {
  if (!problem.owner && problem.entity !== "file") return null;
  return ownerName(problem.owner, problem.entity);
}

/**
 * Where a conflict or lost change sits: its page, layout or collection, and its locale when the
 * draft's change is in another than the default.
 */
function placeInLocale(subject: Conflict | Lost, defaultLocale: string | null): string {
  const place = ownerName(subject.owner, subject.entity);
  if (!subject.locale || subject.locale === defaultLocale) return place;
  return `${place} · ${localeLabel(subject.locale)}`;
}

/** Where in the Canvas a blocker is, or null when it sits on no page, like a definition. */
function blockerTarget(problem: Problem): CanvasTarget | null {
  if (problem.owner?.kind !== "page") return null;
  return {
    pageId: problem.owner.id,
    locale: problem.locale,
    blockId: problem.blockId,
    itemId: problem.entity === "repeatableItem" ? problem.id : null,
    field:
      problem.blockId && problem.field ? { name: problem.field, kind: problem.fieldKind } : null,
  };
}

const isImage = (problem: Problem) =>
  problem.fieldKind === "Image" || problem.fieldKind === "ImageList";

/** What a blocker's action does, named by the fix where it's obvious. */
function blockerActionLabel(problem: Problem): string {
  switch (problem.code) {
    case "emptyRequiredFile":
      return isImage(problem) ? "Choose an image" : "Choose a file";
    case "missingFile":
    case "unacceptedFileType":
      return isImage(problem) ? "Choose another image" : "Choose another file";
    case "emptyRequiredReference":
      return "Choose a record";
    case "danglingReference":
      return "Choose another record";
    case "duplicatePath":
      return "Fix the path";
    case "missingMetaTitle":
      return "Write a meta title";
    default:
      return "Show in Canvas";
  }
}

type Tone = "danger" | "warning";

const TONES: Record<Tone, { card: string; icon: string }> = {
  danger: { card: "border-destructive/30 bg-destructive/5", icon: "text-destructive" },
  warning: {
    card: "border-amber-500/30 bg-amber-500/5",
    icon: "text-amber-600 dark:text-amber-400",
  },
};

/** A conflict as Live's version of an entity in a locale, to tell a new one from those shown. */
const conflictKey = (conflict: Conflict) =>
  JSON.stringify([conflict.entity, conflict.id, conflict.locale, conflict.liveVersion]);

const LOST_REASONS: Record<Lost["reason"], string> = {
  parentGone:
    "What it belongs to is gone from Live and from this draft, so publishing drops this change.",
  writtenAfterDeletion: "This draft deletes what it was added to, so publishing deletes it too.",
};

/**
 * A card for something to know before publishing: blockers in red; removals, conflicts and lost
 * changes in amber.
 */
function Card({
  tone,
  icon: Icon,
  title,
  action,
  children,
}: {
  tone: Tone;
  icon: LucideIcon;
  title: string;
  /** What the member can do about it, under what it says. */
  action?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <li
      className={cn("flex items-start gap-2 rounded-lg border p-3", TONES[tone].card)}
      data-card={tone}
    >
      <Icon className={cn("mt-0.5 size-4 shrink-0", TONES[tone].icon)} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-sm font-medium" data-card-title>
          {title}
        </p>
        {children && <div className="text-muted-foreground text-sm">{children}</div>}
        {action && <div className="pt-1">{action}</div>}
      </div>
    </li>
  );
}

/** From how many problems sharing a message they fold into one card, naming each subject. */
const SHARED_MESSAGE_MIN = 3;

/**
 * Warnings the review shows: what the draft's code removes while Live content uses it, which is
 * about the draft. Other warnings are about problems already on Live, and stay out (ADR 0009).
 */
const isShownWarning = (problem: Problem) => problem.code === "removedInUse";

/**
 * One card per problem, saying what's wrong and where. Problems sharing a message fold into one
 * card naming each: a removed block can sit on dozens of pages, with the same message for each. A problem on a page has an
 * action that shows it in the Canvas; a blocker in the draft's code, which only the agent fixes,
 * one that opens the draft's thread.
 */
function ProblemCards({
  problems,
  tone,
  icon,
  onShow,
  onOpenThread,
}: {
  problems: Problem[];
  tone: Tone;
  icon: LucideIcon;
  onShow: (target: CanvasTarget) => void;
  onOpenThread: () => void;
}) {
  const byMessage = new Map<string, Problem[]>();
  for (const problem of problems) {
    byMessage.set(problem.message, [...(byMessage.get(problem.message) ?? []), problem]);
  }
  return [...byMessage].flatMap(([message, shared]) => {
    if (shared.length < SHARED_MESSAGE_MIN) {
      return shared.map((problem) => {
        const place = problemPlace(problem);
        const target = blockerTarget(problem);
        return (
          <Card
            key={`${problem.code}:${problem.id}:${problem.locale}:${problem.field}`}
            tone={tone}
            icon={icon}
            title={problem.message}
            action={
              problem.entity === "code" ? (
                <Button variant="outline" size="sm" onClick={onOpenThread}>
                  Open the thread
                </Button>
              ) : (
                target && (
                  <Button variant="outline" size="sm" onClick={() => onShow(target)}>
                    {blockerActionLabel(problem)}
                  </Button>
                )
              )
            }
          >
            {place ? `${problem.label} · ${place}` : problem.label}
          </Card>
        );
      });
    }
    return [
      <Card key={`shared:${message}`} tone={tone} icon={icon} title={message}>
        <ul className="flex flex-wrap gap-1 pt-0.5">
          {shared.map((problem) => {
            const place = problemPlace(problem);
            return (
              <li
                key={`${problem.code}:${problem.id}:${problem.locale}:${problem.field}`}
                className="bg-background rounded-md border px-1.5 py-0.5 text-xs"
              >
                <span className="text-foreground">{problem.label}</span>
                {place && ` · ${place}`}
              </li>
            );
          })}
        </ul>
      </Card>,
    ];
  });
}

/** Where the Canvas shows a finding: its field, in its block or item on its page. */
function findingTarget(finding: Finding): CanvasTarget | null {
  const { place } = finding;
  if (place?.kind !== "page") return null;
  return {
    pageId: place.pageId,
    locale: finding.locale,
    blockId: place.blockId,
    itemId: place.itemId,
    field: place.blockId ? { name: finding.field, kind: finding.fieldKind } : null,
  };
}

/**
 * One card per open finding of the draft, which holds its publish (ADR 0033), with the Patrol's
 * actions: show it in the Canvas, apply its fix, or dismiss it.
 */
function FindingCards({
  projectId,
  findings,
  onChanged,
  onShow,
}: {
  projectId: number;
  findings: Finding[];
  onChanged: () => void;
  onShow: (target: CanvasTarget) => void;
}) {
  const applyFix = useMutation({
    ...patrolMutations.applyFix(),
    onSuccess: ({ applied }) => {
      if (!applied)
        toast.info("The link changed since it was checked, so it's being checked again.");
      onChanged();
    },
    onError: (error) => toast.error(error.message || "Could not apply the fix"),
  });
  const dismiss = useMutation({
    ...patrolMutations.dismissFinding(),
    onSuccess: onChanged,
    onError: (error) => toast.error(error.message || "Could not dismiss it"),
  });
  const busy = applyFix.isPending || dismiss.isPending;
  return findings.map((finding) => {
    const target = findingTarget(finding);
    return (
      <Card
        key={finding.id}
        tone="danger"
        icon={CircleAlert}
        title={findingSentence(finding)}
        action={
          <span className="flex flex-wrap gap-1">
            {target && (
              <Button variant="outline" size="sm" onClick={() => onShow(target)}>
                Show
              </Button>
            )}
            {finding.fix && (
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => applyFix.mutate({ projectId, findingId: finding.id })}
              >
                {fixLabel(finding.fix)}
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                studioStore.trigger.askAgent({
                  text: askAgentMessage(finding, finding.patroller.role),
                })
              }
            >
              Ask the agent
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => dismiss.mutate({ projectId, findingId: finding.id })}
            >
              Dismiss
            </Button>
          </span>
        }
      />
    );
  });
}

/** Who made Live's version of a conflict, as a sentence's subject: a member, a release, or none. */
function whoChanged(conflict: Conflict): string | null {
  if (conflict.release) return "A release";
  return conflict.publishedBy?.name ?? null;
}

/** Whose edit a conflict replaces, as its card's title: a member's, a release's, or nobody's. */
function conflictTitle(conflict: Conflict): string {
  if (conflict.liveVersion === null) return `Brings back the ${conflict.label}`;
  if (conflict.release) return `Replaces a release's change to the ${conflict.label}`;
  if (conflict.publishedBy) {
    return `Replaces ${conflict.publishedBy.name}'s edit to the ${conflict.label}`;
  }
  return `Replaces an edit to the ${conflict.label}`;
}

/** What publishing does to a conflict's entity, and when Live changed it. */
function conflictDetail(conflict: Conflict, draftDeletes: boolean): string {
  const who = whoChanged(conflict);
  const when = conflict.publishedAt ? ` on ${dateFormat.format(conflict.publishedAt)}` : "";
  if (conflict.liveVersion === null) {
    const deleted = who ? `${who} deleted it from Live${when}.` : `Live deleted it${when}.`;
    return `${deleted} Publishing brings it back.`;
  }
  const changed = who ? `${who} changed it on Live${when}.` : `Live changed it${when}.`;
  return draftDeletes
    ? `${changed} This draft deletes it, so publishing deletes it anyway.`
    : `${changed} Publishing replaces it with this draft's version.`;
}

/** Who made Live's version of a conflict and when, labelling Live's values: "On Live now · Ada, Oct 13". */
function liveValuesLabel(conflict: Conflict): string {
  const made = [
    whoChanged(conflict),
    conflict.publishedAt ? dateFormat.format(conflict.publishedAt) : null,
  ].filter((part) => part !== null);
  return made.length > 0 ? `On Live now · ${made.join(", ")}` : "On Live now";
}

/**
 * The fields a conflict overwrites: Live's value crossed out, above the draft's, and how many
 * more fields differ.
 */
function ConflictFields({ conflict }: { conflict: Conflict }) {
  if (conflict.fields.length === 0) return null;
  const liveLabel = liveValuesLabel(conflict);
  return (
    <div className="flex flex-col gap-2 pt-1">
      {conflict.fields.map(({ field, live, draft }) => (
        <div
          key={field}
          className="bg-background flex flex-col gap-1 rounded-md border p-2"
          data-conflict-field
        >
          <p className="text-foreground text-xs font-medium" data-field-title>
            {field}
          </p>
          <div className="flex flex-col">
            <span className="text-xs">{liveLabel}</span>
            <del className="break-words" data-live-value>
              {live}
            </del>
          </div>
          <div className="flex flex-col">
            <span className="text-xs">This draft</span>
            <span className="text-foreground break-words" data-draft-value>
              {draft}
            </span>
          </div>
        </div>
      ))}
      {conflict.moreFields > 0 && (
        <p className="text-xs">And {plural(conflict.moreFields, "more field")}</p>
      )}
    </div>
  );
}

/** Whose version of a conflict's entity Live holds, for its "Use … version instead" action. */
function liveVersionName(conflict: Conflict): string {
  if (conflict.release) return "a release's";
  if (conflict.publishedBy) return `${conflict.publishedBy.name}'s`;
  return "Live's";
}

/**
 * Drops the draft's change to a conflict's entity, so the draft reads Live's version again, then
 * reads the review again: the conflict is gone, and the preview has a new token.
 */
function UseLiveVersionButton({
  projectId,
  conflict,
  onUsed,
}: {
  projectId: number;
  conflict: Conflict;
  onUsed: () => void;
}) {
  const revert = useMutation({
    ...draftMutations.revertToLive(),
    onSuccess: onUsed,
    onError: (error) => {
      toast.error(error.message || "Could not use Live's version");
      onUsed();
    },
  });
  return (
    <Button
      variant="outline"
      size="sm"
      className="mt-1"
      disabled={revert.isPending}
      onClick={() => revert.mutate({ projectId, entity: conflict.entity, id: conflict.id })}
    >
      {revert.isPending ? <Spinner /> : null}
      Use {liveVersionName(conflict)} version instead
    </Button>
  );
}

/**
 * Blockers first, then what the draft's code removes while Live content uses it, then conflicts,
 * then lost changes: one card each, with no section heading.
 */
function Cards({
  projectId,
  preview,
  onChanged,
  onShow,
  onOpenThread,
}: {
  projectId: number;
  preview: PublishPreview;
  /** Reads the review again, after an action on a card changed the draft. */
  onChanged: () => void;
  /** Shows a problem in the Canvas. */
  onShow: (target: CanvasTarget) => void;
  /** Opens the draft's thread, for a blocker only the agent fixes. */
  onOpenThread: () => void;
}) {
  const { blockers, findings, conflicts, lost, changes, defaultLocale } = preview;
  const warnings = preview.warnings.filter(isShownWarning);
  const count = blockers.length + findings.length + warnings.length + conflicts.length;
  if (count + lost.length === 0) return null;
  const deleted = new Set(
    changes
      .filter((change) => change.change === "deleted")
      .map((change) => JSON.stringify([change.entity, change.id, change.locale])),
  );
  return (
    <ul className="flex flex-col gap-2">
      <ProblemCards
        problems={blockers}
        tone="danger"
        icon={OctagonX}
        onShow={onShow}
        onOpenThread={onOpenThread}
      />
      <FindingCards
        projectId={projectId}
        findings={findings}
        onChanged={onChanged}
        onShow={onShow}
      />
      <ProblemCards
        problems={warnings}
        tone="warning"
        icon={TriangleAlert}
        onShow={onShow}
        onOpenThread={onOpenThread}
      />
      {conflicts.map((conflict) => (
        <Card
          key={conflictKey(conflict)}
          tone="warning"
          icon={Replace}
          title={conflictTitle(conflict)}
        >
          <p>{placeInLocale(conflict, defaultLocale)}</p>
          <p>
            {conflictDetail(
              conflict,
              deleted.has(JSON.stringify([conflict.entity, conflict.id, conflict.locale])),
            )}
          </p>
          <ConflictFields conflict={conflict} />
          {conflict.revertible && (
            <UseLiveVersionButton projectId={projectId} conflict={conflict} onUsed={onChanged} />
          )}
        </Card>
      ))}
      {lost.map((change) => (
        <Card
          key={JSON.stringify([change.entity, change.id, change.locale])}
          tone="warning"
          icon={Unlink}
          // A change added after its parent's deletion is labelled as such already.
          title={
            change.reason === "writtenAfterDeletion"
              ? change.label
              : `Loses the change to the ${change.label}`
          }
        >
          <p>{placeInLocale(change, defaultLocale)}</p>
          <p>{LOST_REASONS[change.reason]}</p>
        </Card>
      ))}
    </ul>
  );
}

/** A quiet line saying something is done, with a check, or still running, with a spinner. */
function StatusLine({ done, children }: { done: boolean; children: React.ReactNode }) {
  return (
    <li className="text-muted-foreground flex items-start gap-2 text-sm" data-status-line>
      {done ? (
        <CircleCheck className="mt-0.5 size-4 shrink-0" />
      ) : (
        <Spinner aria-hidden className="mt-0.5 size-4 shrink-0" />
      )}
      <span>{children}</span>
    </li>
  );
}

/** What Publish sends: the review's token, and the revision a draft with code shows. */
const publishInput = (projectId: number, shown: PublishPreview) => ({
  projectId,
  token: shown.token,
  ...(shown.code?.revision && { revision: shown.code.revision }),
});

/** Why a publish with code went back to the review, as the review says it. */
const PUBLISH_ABORTED: Record<string, string> = {
  revisionChanged:
    "The draft's code changed since this review opened, so the publish stopped. Check the preview, then publish again.",
  conflictsChanged:
    "Live changed while publishing, so the publish stopped and Live is as it was. Check the new list.",
  blocked: "Something now needs fixing before publishing, so the publish stopped.",
  codeDoesNotMerge:
    "Live's code changed while publishing, and it doesn't merge with this draft's yet, so the publish stopped. Camox's agent is fixing it in the draft's thread: publish again once it's done.",
  liveCodeMoved:
    "Live's code changed while publishing, and the draft took too long to take it in, so the publish stopped. Try again.",
  failed: "The publish couldn't finish on Camox's side, and Live is as it was. Try again.",
};

/** The patrollers still checking the draft: "The Link checker is checking the draft." */
function checkingSentence(roles: string[]): string {
  const who = listFormat.format(roles.map((role) => `the ${role}`));
  return `${who[0]!.toUpperCase()}${who.slice(1)} ${roles.length > 1 ? "are" : "is"} checking the draft.`;
}

/**
 * What's fine or still running: the draft is up to date with Live, its latest code changes
 * building, its translations, its patrollers' checks, and the page SEO being written.
 */
function StatusLines({
  preview,
  locales,
}: {
  preview: PublishPreview;
  /** The website's locales, to tell a multilingual website. */
  locales: { tag: string; isDefault: boolean }[];
}) {
  const { conflicts, translating, checking, warnings, code } = preview;
  const translations = locales.filter((locale) => !locale.isDefault).map((locale) => locale.tag);
  const seoPages = new Set(
    warnings.filter((warning) => warning.code === "metaTitlePending").map((warning) => warning.id),
  ).size;
  const aborted = code?.publishAborted && !code.publishing ? code.publishAborted : null;
  return (
    <ul className="flex flex-col gap-1.5">
      {aborted && (
        <li className="text-sm text-amber-700 dark:text-amber-400">
          {PUBLISH_ABORTED[aborted] ?? PUBLISH_ABORTED.failed}
        </li>
      )}
      {conflicts.length === 0 && (code?.includesLive ?? true) && (
        <StatusLine done>Includes everything published to Live since this draft started</StatusLine>
      )}
      {code?.building && <StatusLine done={false}>Building the latest changes…</StatusLine>}
      {code?.publishing && (
        <StatusLine done={false}>Publishing the new code and content…</StatusLine>
      )}
      {translating.length > 0 ? (
        <StatusLine done={false}>
          Translating into {listFormat.format(translating.map(localeLabel))}. Publishing waits for
          it.
        </StatusLine>
      ) : (
        translations.length > 0 && (
          <StatusLine done>
            Translated into {listFormat.format(translations.map(localeLabel))}
          </StatusLine>
        )
      )}
      {checking.length > 0 && (
        <StatusLine done={false}>
          {checkingSentence(checking.map(({ role }) => role))} Publishing waits for{" "}
          {checking.length > 1 ? "them" : "it"}.
        </StatusLine>
      )}
      {seoPages > 0 && (
        <StatusLine done={false}>Writing SEO for {plural(seoPages, "page")}…</StatusLine>
      )}
    </ul>
  );
}

/**
 * The draft's overview: the bullets AI wrote about its changes, in full, under the headline the
 * header shows, saying it's updating while they describe an older version of the draft. While
 * it's first written, skeleton lines; once it failed, a Retry and a plain count of the changes,
 * so the draft can still be reviewed. Nothing for a draft that gets no overview, as a catch-up
 * draft.
 */
function DraftOverview({ projectId, preview }: { projectId: number; preview: PublishPreview }) {
  const { overview, changes } = preview;
  const retry = useMutation({
    ...draftMutations.retryOverview(),
    onError: (error) => toast.error(error.message || "Could not summarize the draft"),
  });

  if (changes.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        {preview.code ? "This draft changes the website's code." : "This draft has no changes."}
      </p>
    );
  }
  if (overview.status === "ready") {
    return (
      <div data-overview className="flex flex-col gap-2">
        <ul className="text-foreground/85 flex list-disc flex-col gap-1.5 pl-5 leading-relaxed">
          {overview.bullets.map((bullet, index) => (
            <li key={index}>{bullet}</li>
          ))}
        </ul>
        {/* The draft changed since: these describe an older version until the new ones land. */}
        {overview.stale && (
          <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
            <Spinner aria-hidden className="size-3" />
            Updating…
          </p>
        )}
      </div>
    );
  }
  if (overview.status === "failed") {
    const places = new Set(
      changes.map((change) =>
        change.entity === "locale" ? "Languages" : ownerName(change.owner, change.entity),
      ),
    ).size;
    return (
      <div data-overview className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <p className="text-sm font-medium">Couldn't summarize this draft</p>
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            disabled={retry.isPending}
            onClick={() => retry.mutate({ projectId })}
          >
            {retry.isPending ? <Spinner /> : null}
            Retry
          </Button>
        </div>
        <p className="text-muted-foreground text-sm">
          {plural(changes.length, "change")} in {plural(places, "place")}
        </p>
      </div>
    );
  }
  if (overview.status === "none") return null;
  return (
    <div data-overview className="flex flex-col gap-2">
      <Skeleton className="h-4 w-11/12" />
      <Skeleton className="h-4 w-4/5" />
      <Skeleton className="h-4 w-2/3" />
      <p className="text-muted-foreground text-sm">Summarizing this draft…</p>
    </div>
  );
}

/**
 * Reviews a draft before publishing it whole, or deletes it (ADR 0009). Publishing sends back
 * the token of the preview shown; when Live changed since, nothing is published and the new
 * preview is shown. Once the draft ends, the studio switches to Live.
 */
export function ReviewDraftSheet({
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
  const [confirmingDelete, setConfirmingDelete] = React.useState(false);
  const preview = useReadQuery(reads.publishPreview({ projectId, draftId }), { enabled: open });
  const draft = useReadQuery(reads.draft({ projectId, draftId }), { enabled: open });
  const locales = useReadQuery(reads.localeList({ projectId }), { enabled: open });
  const leaveDraft = useLeaveDraft();
  const showInCanvas = useShowInCanvas();
  const popup = React.useRef<HTMLDivElement>(null);

  // The draft's summary follows its pending translations: the preview is read again as they
  // settle, so Publish becomes available once they're done.
  const pending = draft.data?.translatingLocales.join(",");
  const seenPending = React.useRef(pending);
  const { refetch } = preview;
  React.useEffect(() => {
    if (seenPending.current !== undefined && seenPending.current !== pending) void refetch();
    seenPending.current = pending;
  }, [pending, refetch]);

  const leave = (ended: EndedDraft | null) => {
    onOpenChange(false);
    leaveDraft(ended);
  };

  const publish = useMutation({
    ...draftMutations.publish(),
    onSuccess: (result) => {
      // A draft with code publishes in the background: its viewers learn it landed from the
      // project room, which ends the draft.
      if ("publishing" in result && result.publishing) return void preview.refetch();
      const { empty, ended } = result;
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
      if ((error as { code?: string }).code === REVISION_CHANGED_ERROR) {
        toast.error(error.message || "The draft changed since you opened this review.");
        void preview.refetch();
        return;
      }
      if ((error as { code?: string }).code === TRANSLATIONS_PENDING_ERROR) {
        toast.info("Translations are still running. Publishing waits for them.");
        void preview.refetch();
        return;
      }
      const code = (error as { code?: string }).code;
      if (code === FINDINGS_OPEN_ERROR || code === CHECKS_RUNNING_ERROR) {
        toast.info(error.message);
        void preview.refetch();
        return;
      }
      toast.error(error.message || "Could not publish the draft");
      void preview.refetch();
    },
  });

  const data = preview.data;
  const headline = data?.overview.status === "ready" ? data.overview.headline : null;
  const busy = publish.isPending;
  // Publishing waits for the draft's latest code changes to build, so they're previewed first,
  // for its pending translations, so every locale goes live together, and for its patrollers'
  // checks and the findings they raised (ADR 0033).
  const ready =
    !!data &&
    data.blockers.length === 0 &&
    data.translating.length === 0 &&
    data.findings.length === 0 &&
    data.checking.length === 0 &&
    !data.code?.building &&
    !data.code?.publishing &&
    !busy &&
    !preview.isFetching;

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          ref={popup}
          initialFocus={popup}
          side="right"
          className="w-full gap-0 data-[side=right]:sm:max-w-lg"
        >
          <div className="flex flex-col gap-1 border-b p-4 pr-12">
            {headline ? (
              // The overview's headline titles the review, under the draft's name and author.
              <>
                <SheetDescription className="flex min-w-0 items-center gap-1">
                  {draft.data && (
                    <>
                      <span className="truncate">{draftLabel(draft.data)}</span>
                      <span className="shrink-0">
                        · {draft.data.createdBy.name}, started {timeAgo(draft.data.createdAt)}
                      </span>
                    </>
                  )}
                </SheetDescription>
                <SheetTitle className="text-lg leading-snug font-semibold">{headline}</SheetTitle>
              </>
            ) : (
              <>
                <SheetTitle className="truncate text-base">
                  {draft.data ? draftLabel(draft.data) : "Draft"}
                </SheetTitle>
                <SheetDescription>
                  {draft.data
                    ? `${draft.data.createdBy.name} · started ${timeAgo(draft.data.createdAt)}`
                    : "Publishing applies this whole draft to Live."}
                </SheetDescription>
              </>
            )}
          </div>
          {data ? (
            <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-4">
              <DraftOverview projectId={projectId} preview={data} />
              <Cards
                projectId={projectId}
                preview={data}
                onChanged={() => void preview.refetch()}
                onShow={(target) => {
                  onOpenChange(false);
                  void showInCanvas(target);
                }}
                onOpenThread={() => {
                  onOpenChange(false);
                  // The draft's thread is beside the Canvas.
                  previewStore.send({ type: "showCanvas" });
                }}
              />
              <StatusLines preview={data} locales={locales.data ?? []} />
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center">
              <Spinner className="text-muted-foreground" />
            </div>
          )}
          <div className="flex flex-col gap-3 border-t p-4">
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                className="text-destructive"
                disabled={busy}
                onClick={() => setConfirmingDelete(true)}
              >
                <Trash2 />
                Delete draft
              </Button>
              <Button
                className="ml-auto"
                disabled={!ready}
                onClick={() => data && publish.mutate(publishInput(projectId, data))}
              >
                {publish.isPending ? <Spinner /> : null}
                Publish
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <DeleteDraftDialog
        projectId={projectId}
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        onDeleted={leave}
      />
    </>
  );
}

/** Asks before deleting the draft the studio is in, then deletes it. */
export function DeleteDraftDialog({
  projectId,
  open,
  onOpenChange,
  onDeleted,
}: {
  projectId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted: (ended: EndedDraft | null) => void;
}) {
  const deleteDraft = useMutation({
    ...draftMutations.delete(),
    onSuccess: ({ ended }) => {
      onOpenChange(false);
      onDeleted(ended);
    },
    onError: (error) => toast.error(error.message || "Could not delete the draft"),
  });

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!deleteDraft.isPending) onOpenChange(next);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this draft?</AlertDialogTitle>
          <AlertDialogDescription>
            Every change in this draft is deleted for everyone. Live stays as it is. This can't be
            undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel variant="outline" size="default" disabled={deleteDraft.isPending}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={deleteDraft.isPending}
            onClick={() => deleteDraft.mutate({ projectId })}
          >
            {deleteDraft.isPending ? <Spinner /> : null}
            Delete draft
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
