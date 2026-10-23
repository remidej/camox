import type { PublishPreview } from "@camox/api-contract";
import {
  CONFLICTS_CHANGED_ERROR,
  type EndedDraft,
  TRANSLATIONS_PENDING_ERROR,
} from "@camox/api-contract/drafts";
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
import { CircleCheck, type LucideIcon, OctagonX, Replace, Trash2, Unlink } from "lucide-react";
import * as React from "react";

import { useDraftScope } from "@/lib/draft-scope";
import { draftMutations, type DraftSummary } from "@/lib/queries";
import { cn } from "@/lib/utils";

import { reads, useReadQuery } from "../../../lib/studio-reads";
import { draftLabel, plural, timeAgo } from "../draftLabel";
import { localeLabel } from "../localeOptions";
import { useRenameDraft } from "./RenameDraftDialog";

type Subject = PublishPreview["changes"][number];
type Problem = PublishPreview["blockers"][number];
type Conflict = PublishPreview["conflicts"][number];
type Lost = PublishPreview["lost"][number];

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
function placeOf(subject: Conflict | Lost, defaultLocale: string | null): string {
  const place = ownerName(subject.owner, subject.entity);
  if (!subject.locale || subject.locale === defaultLocale) return place;
  return `${place} · ${localeLabel(subject.locale)}`;
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
 * A card for something to know before publishing, with no section heading: blockers in red,
 * conflicts and lost changes in amber.
 */
function Card({
  tone,
  icon: Icon,
  title,
  children,
}: {
  tone: Tone;
  icon: LucideIcon;
  title: string;
  children: React.ReactNode;
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
        <div className="text-muted-foreground text-sm">{children}</div>
      </div>
    </li>
  );
}

/** From how many blockers sharing a message they fold into one card, naming each subject. */
const SHARED_MESSAGE_MIN = 3;

/**
 * One card per blocker, saying what's wrong and where. Blockers sharing a message fold into one
 * card naming each: a development draft can hold dozens of definitions to release, and the
 * message is the same for each.
 */
function BlockerCards({ blockers }: { blockers: Problem[] }) {
  const byMessage = new Map<string, Problem[]>();
  for (const problem of blockers) {
    byMessage.set(problem.message, [...(byMessage.get(problem.message) ?? []), problem]);
  }
  return [...byMessage].flatMap(([message, shared]) => {
    if (shared.length < SHARED_MESSAGE_MIN) {
      return shared.map((problem) => {
        const place = problemPlace(problem);
        return (
          <Card
            key={`${problem.code}:${problem.id}:${problem.locale}:${problem.field}`}
            tone="danger"
            icon={OctagonX}
            title={problem.message}
          >
            {place ? `${problem.label} · ${place}` : problem.label}
          </Card>
        );
      });
    }
    return [
      <Card key={`shared:${message}`} tone="danger" icon={OctagonX} title={message}>
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

/** Blockers first, then conflicts, then lost changes: one card each, with no section heading. */
function Cards({ preview }: { preview: PublishPreview }) {
  const { blockers, conflicts, lost, changes, defaultLocale } = preview;
  if (blockers.length + conflicts.length + lost.length === 0) return null;
  const deleted = new Set(
    changes
      .filter((change) => change.change === "deleted")
      .map((change) => JSON.stringify([change.entity, change.id, change.locale])),
  );
  return (
    <ul className="flex flex-col gap-2">
      <BlockerCards blockers={blockers} />
      {conflicts.map((conflict) => (
        <Card
          key={conflictKey(conflict)}
          tone="warning"
          icon={Replace}
          title={conflictTitle(conflict)}
        >
          <p>{placeOf(conflict, defaultLocale)}</p>
          <p>
            {conflictDetail(
              conflict,
              deleted.has(JSON.stringify([conflict.entity, conflict.id, conflict.locale])),
            )}
          </p>
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
          <p>{placeOf(change, defaultLocale)}</p>
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
        <CircleCheck className="mt-0.5 size-4 shrink-0 text-green-600 dark:text-green-400" />
      ) : (
        <Spinner aria-hidden className="mt-0.5 size-4 shrink-0" />
      )}
      <span>{children}</span>
    </li>
  );
}

/**
 * What's fine or still running: the draft is up to date with Live, its translations, and the
 * page SEO being written.
 */
function StatusLines({
  preview,
  locales,
  waiting,
}: {
  preview: PublishPreview;
  /** The website's locales, to tell a multilingual website. */
  locales: { tag: string; isDefault: boolean }[];
  /** Whether publishing was asked for while translating, and runs once they're done. */
  waiting: boolean;
}) {
  const { conflicts, translating, warnings } = preview;
  const translations = locales.filter((locale) => !locale.isDefault).map((locale) => locale.tag);
  const seoPages = new Set(
    warnings.filter((warning) => warning.code === "metaTitlePending").map((warning) => warning.id),
  ).size;
  return (
    <ul className="flex flex-col gap-1.5">
      {conflicts.length === 0 && (
        <StatusLine done>Includes everything published to Live since this draft started</StatusLine>
      )}
      {translating.length > 0 ? (
        <StatusLine done={false}>
          Translating into {listFormat.format(translating.map(localeLabel))}.{" "}
          {waiting ? "Publishing once translated." : "Publishing waits for it."}
        </StatusLine>
      ) : (
        translations.length > 0 && (
          <StatusLine done>
            Translated into {listFormat.format(translations.map(localeLabel))}
          </StatusLine>
        )
      )}
      {seoPages > 0 && (
        <StatusLine done={false}>Writing SEO for {plural(seoPages, "page")}…</StatusLine>
      )}
    </ul>
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
 * The draft's name in the review's header, renamed in place by any member (#203), like a page
 * nickname in the Canvas Inspector: a title whose border shows on hover or focus, without
 * moving the text. An unnamed draft shows its computed label until focused. Saves on Enter or
 * blur, and a blank name clears it; Escape puts the name back.
 */
function DraftNameInput({
  projectId,
  draft,
  ref,
}: {
  projectId: number;
  draft: DraftSummary;
  ref: React.Ref<HTMLInputElement>;
}) {
  const rename = useRenameDraft(projectId);
  const name = draft.name ?? "";

  const save = (input: HTMLInputElement) => {
    if ((input.value.trim() || null) === draft.name) {
      input.value = name;
      return;
    }
    rename.mutate(
      { draftId: draft.id, name: input.value },
      { onError: () => void (input.value = name) },
    );
  };
  return (
    <input
      ref={ref}
      // A new name, from here or elsewhere, resets what's typed.
      key={name}
      aria-label="Draft name"
      defaultValue={name}
      placeholder={draftLabel({ ...draft, name: null })}
      title={draftLabel(draft)}
      maxLength={200}
      className="hover:border-input focus-visible:border-ring focus-visible:ring-ring/50 placeholder:text-foreground focus:placeholder:text-muted-foreground -mx-1.5 h-8 w-full min-w-0 truncate rounded-md border border-transparent bg-transparent px-1.5 text-base font-medium transition-[color,box-shadow,border-color] outline-none hover:shadow-xs focus-visible:ring-3"
      onBlur={(event) => save(event.currentTarget)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }
        if (event.key !== "Escape") return;
        // Cancels the rename only, not the whole review.
        event.stopPropagation();
        event.currentTarget.value = name;
        event.currentTarget.blur();
      }}
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
  const locales = useReadQuery(reads.localeList({ projectId }), { enabled: open });
  const leaveDraft = useLeaveDraft();
  const popup = React.useRef<HTMLDivElement>(null);
  const nameInput = React.useRef<HTMLInputElement>(null);
  /**
   * Opened to rename, the name is focused and selected to type over. Otherwise the sheet itself
   * is, so the name doesn't read as being edited.
   */
  const initialFocus = () => {
    if (startRenaming && nameInput.current) {
      nameInput.current.select();
      return nameInput.current;
    }
    return popup.current;
  };

  // The draft's summary follows its pending translations: the preview is read again as they
  // settle, so publishing stops waiting once they're done.
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
      if ((error as { code?: string }).code === TRANSLATIONS_PENDING_ERROR) {
        toast.info("Translations are still running. Wait for them, or publish anyway.");
        void preview.refetch();
        return;
      }
      toast.error(error.message || "Could not publish the draft");
      void preview.refetch();
    },
  });

  const data = preview.data;
  const busy = publish.isPending;
  const ready = !!data && data.blockers.length === 0 && !busy && !preview.isFetching;
  // Publishing waits for pending translations, so every locale goes live together (ADR 0017).
  const translating = data?.translating ?? [];

  // Publish while translations run waits for them, then publishes the preview as it is by
  // then. A blocker or a conflict not shown when asked stops waiting: the sheet shows them as
  // usual, for the member to review before publishing.
  const [waiting, setWaiting] = React.useState<{ conflicts: Set<string> } | null>(null);
  const translated = !!data && !preview.isFetching && data.translating.length === 0;
  if (waiting && translated) {
    const appeared = data.conflicts.some(
      (conflict) => !waiting.conflicts.has(conflictKey(conflict)),
    );
    if (data.blockers.length > 0 || appeared) setWaiting(null);
  }
  const { mutate } = publish;
  React.useEffect(() => {
    if (!waiting || !translated || !data || busy) return;
    mutate({ projectId, token: data.token }, { onSettled: () => setWaiting(null) });
  }, [waiting, translated, data, busy, mutate, projectId]);

  const publishWhole = () => {
    if (!data) return;
    if (translating.length === 0) return publish.mutate({ projectId, token: data.token });
    setWaiting({ conflicts: new Set(data.conflicts.map(conflictKey)) });
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          ref={popup}
          initialFocus={initialFocus}
          side="right"
          className="w-full gap-0 data-[side=right]:sm:max-w-lg"
        >
          <div className="flex flex-col gap-1 border-b p-4 pr-12">
            {draft.data?.kind === "regular" ? (
              <>
                <SheetTitle className="sr-only">{draftLabel(draft.data)}</SheetTitle>
                <DraftNameInput ref={nameInput} projectId={projectId} draft={draft.data} />
              </>
            ) : (
              <SheetTitle className="text-base">
                {draft.data ? draftLabel(draft.data) : "Draft"}
              </SheetTitle>
            )}
            <SheetDescription>
              {draft.data
                ? `${draft.data.createdBy.name} · started ${timeAgo(draft.data.createdAt)}`
                : "Publishing applies this whole draft to Live."}
            </SheetDescription>
          </div>
          {data ? (
            <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-4">
              {data.changes.length === 0 && (
                <p className="text-muted-foreground text-sm">This draft has no changes.</p>
              )}
              <Cards preview={data} />
              <StatusLines preview={data} locales={locales.data ?? []} waiting={!!waiting} />
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
                onClick={() => setConfirmingDiscard(true)}
              >
                <Trash2 />
                Discard draft
              </Button>
              {translating.length > 0 && (
                <Button
                  variant="outline"
                  className="ml-auto"
                  disabled={!ready}
                  onClick={() =>
                    data && publish.mutate({ projectId, token: data.token, publishAnyway: true })
                  }
                >
                  Publish anyway
                </Button>
              )}
              <Button
                className={cn(translating.length === 0 && "ml-auto")}
                disabled={!ready || !!waiting}
                onClick={publishWhole}
              >
                {publish.isPending || waiting ? <Spinner /> : null}
                Publish
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
