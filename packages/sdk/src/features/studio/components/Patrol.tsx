import {
  type FindingView,
  type PatrollerId,
  type PatrollerView,
  type PatrolView,
  reportLocale,
  type ReportPlace,
  type ReportView,
} from "@camox/api-contract/patrol";
import { Badge } from "@camox/ui/badge";
import { Button } from "@camox/ui/button";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@camox/ui/popover";
import { useMutation } from "@tanstack/react-query";
import * as React from "react";

import { AuthContext } from "../../../lib/auth";
import { useCurrentDraftId } from "../../../lib/draft-scope";
import { localizedPath } from "../../../lib/locale-path";
import { patrolMutations } from "../../../lib/queries";
import { reads, useReadQuery } from "../../../lib/studio-reads";
import { cn } from "../../../lib/utils";
import { useViewLocale } from "../../../lib/view-locale-context";
import { useNavigate } from "../../navigation/navigation";
import { AssetLightbox } from "../../preview/components/AssetLightbox";
import { BOTTOM_CARD_EDGES, CARD_BODY_EDGES } from "../../preview/components/SidebarStack";
import {
  askAgentMessage,
  dismissLabel,
  dismissedSentence,
  findingSentence,
  fixLabel,
} from "../findingSentence";
import { aboutSentence, whenTag } from "../patrollerBio";
import { moreSentence, reportSentence, shortTimeAgo, whereReportLeads } from "../reportSentence";
import { editCollectionItemPath } from "../routes";
import { type CanvasTarget, useShowInCanvas } from "../showInCanvas";
import { studioStore } from "../studioStore";
import { workingSentence } from "../workingSentence";
import { Squareling } from "./Squareling";

/**
 * The Agent Sidebar's Patrol, over the Chat widget: every patroller of the project, and what each
 * did without being asked in the draft viewed, or on Live (ADR 0024). It fetches the Patrol of the
 * scope viewed, and holds which patroller's reports are open.
 */
export function Patrol({ className }: { className?: string }) {
  const { projectUuid } = React.useContext(AuthContext)!;
  const { data: project } = useReadQuery(reads.project({ projectUuid }));
  const draftId = useCurrentDraftId();
  return (
    <section aria-label="Patrol" data-patrol className={cn("flex flex-col", className)}>
      {/* A card like the Chat widget's, in height, edges and type. */}
      <header
        className={cn(
          "bg-background flex h-11 min-w-0 shrink-0 items-center justify-center px-3",
          BOTTOM_CARD_EDGES,
        )}
      >
        <h2 className="truncate text-sm font-medium">Patrol</h2>
      </header>
      <div
        className={cn(
          "bg-background flex min-h-0 flex-1 flex-col overflow-y-auto",
          CARD_BODY_EDGES,
        )}
      >
        {project && <ProjectPatrol projectId={project.id} inDraft={draftId !== null} />}
      </div>
    </section>
  );
}

function ProjectPatrol({ projectId, inDraft }: { projectId: number; inDraft: boolean }) {
  const { data: view } = useReadQuery(reads.patrol({ projectId }));
  const { data: locales } = useReadQuery(reads.localeList({ projectId }));
  // Followed by its id, whatever its place in the roster.
  const [open, setOpen] = React.useState<PatrollerId | null>(null);
  // The relative times move on while the Patrol stays open.
  const now = useNow(30_000);
  const [openFileId, setOpenFileId] = React.useState<string | null>(null);
  const showReport = useShowReport(inDraft, setOpenFileId);
  const navigate = useNavigate();
  const applyFix = useMutation(patrolMutations.applyFix());
  const dismissFinding = useMutation(patrolMutations.dismissFinding());
  if (!view) return null;
  return (
    <div>
      <PatrolRoster
        view={view}
        now={now}
        inDraft={inDraft}
        singleLocale={locales?.length === 1}
        open={open}
        onOpenChange={setOpen}
        onShow={(shown) => {
          // Showing it moves the editor on, which leaves the reports.
          setOpen(null);
          showReport(shown);
        }}
        onApply={(finding) => applyFix.mutate({ projectId, findingId: finding.id })}
        onAsk={(patroller, finding) => {
          // The chat takes over from the popover.
          setOpen(null);
          studioStore.trigger.askAgent({ text: askAgentMessage(finding, patroller.role) });
        }}
        onDismiss={(finding) => dismissFinding.mutate({ projectId, findingId: finding.id })}
        onOpenPatrolDraft={(draft, finding) => {
          setOpen(null);
          // Opened on the finding, its field selected, when it shows on a page or a record.
          const kind = finding.place?.kind;
          if (kind === "page" || kind === "record")
            showReport({ ...shownOfFinding(finding), draft });
          else void navigate({ to: window.location.href, draft: draft.id });
        }}
      />
      {openFileId && (
        <AssetLightbox
          open
          onOpenChange={(open) => {
            if (!open) setOpenFileId(null);
          }}
          fileId={openFileId}
        />
      )}
    </div>
  );
}

/** The project's open Patrol Draft, as the Patrol names it. */
type PatrolDraft = NonNullable<PatrolView["patrolDraft"]>;

/**
 * What the Patrol shows where it is: a report's or a finding's subject, in its locale, with the
 * field to select in it, if any. Shown in the draft viewed, or in `draft` when given.
 */
export type Shown = {
  place: ReportPlace | null;
  live: boolean;
  locale: string | null;
  field?: CanvasTarget["field"];
  draft?: PatrolDraft;
};

/** A report, as the Patrol shows its subject. */
const shownOf = (report: ReportView): Shown => ({
  ...report,
  locale: reportLocale(report.summary),
});

/** A finding, as the Patrol shows its subject: its field selected. */
const shownOfFinding = (finding: FindingView): Shown => ({
  place: finding.place,
  live: finding.live,
  locale: finding.locale,
  field: { name: finding.field, kind: finding.fieldKind },
});

/**
 * Shows a report's or a finding's subject where it is, in its locale, and on Live for a Live one
 * seen from a draft, or in the draft it names: a page, block, item or field selected on the
 * Canvas, a record in its collection, or a file, opened over the Canvas.
 */
function useShowReport(inDraft: boolean, openFile: (fileId: string) => void) {
  const showInCanvas = useShowInCanvas();
  const navigate = useNavigate();
  const view = useViewLocale();
  return (report: Shown) => {
    const { place } = report;
    if (!place) return;
    const inScope = report.draft
      ? { draft: report.draft.id }
      : inDraft && report.live
        ? { draft: null }
        : {};
    const tag = report.locale;
    if (place.kind === "page") {
      const { pageId, blockId, itemId } = place;
      const field = blockId ? report.field : null;
      return void showInCanvas({ pageId, locale: tag, blockId, itemId, field, ...inScope });
    }
    if (place.kind === "record") {
      const locale = view.locales.find((each) => each.tag === tag) ?? view.locale;
      const path = editCollectionItemPath(place.collectionId, place.recordId);
      return void navigate({ to: localizedPath(path, locale), ...inScope });
    }
    if (inDraft && report.live) void navigate({ to: window.location.href, draft: null });
    openFile(place.fileId);
  };
}

/** The time now, updated every `intervalMs`. */
function useNow(intervalMs: number) {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(interval);
  }, [intervalMs]);
  return now;
}

/**
 * A `PatrolView`, in the order it gives, as avatars in rows of three, each over its role like a
 * story. Each opens its reports in a popover to the left, under its role and when it last worked,
 * or what it's on. Live's reports carry a tag when a draft is viewed. In a project with a single
 * locale, the Translator invites the editor to add a language instead.
 */
export function PatrolRoster({
  view,
  now,
  inDraft,
  singleLocale,
  open,
  onOpenChange,
  onShow,
  onApply,
  onAsk,
  onDismiss,
  onOpenPatrolDraft,
}: {
  view: PatrolView;
  now: number;
  inDraft: boolean;
  singleLocale: boolean;
  /** The patroller whose reports are open, if any. */
  open: PatrollerId | null;
  onOpenChange: (id: PatrollerId | null) => void;
  /** Shows a report's or a finding's subject where it is: one with a place only. */
  onShow: (shown: Shown) => void;
  /** Applies a finding's suggested fix. */
  onApply: (finding: FindingView) => void;
  /** Fills the draft's chat with a finding of a patroller, for the agent. */
  onAsk: (patroller: PatrollerView, finding: FindingView) => void;
  /** Dismisses a finding for the whole project. */
  onDismiss: (finding: FindingView) => void;
  /** Opens the Patrol Draft, where Live's findings are fixed. */
  onOpenPatrolDraft: (draft: PatrolDraft, finding: FindingView) => void;
}) {
  return (
    <div className="px-1 py-3">
      <ul className="mx-auto grid w-fit grid-cols-[repeat(3,5rem)] gap-y-3.5">
        {view.patrollers.map((patroller) => (
          <PatrollerRow
            key={patroller.id}
            patroller={patroller}
            now={now}
            inDraft={inDraft}
            singleLocale={singleLocale}
            open={open === patroller.id}
            onOpenChange={(next) => onOpenChange(next ? patroller.id : null)}
            onShow={onShow}
            onApply={onApply}
            onAsk={onAsk}
            onDismiss={onDismiss}
            patrolDraft={view.patrolDraft}
            onOpenPatrolDraft={onOpenPatrolDraft}
          />
        ))}
      </ul>
    </div>
  );
}

/**
 * A thin, low-contrast arc travelling around a working patroller's avatar, where its story ring
 * goes, or the whole ring pulsing slowly under reduced motion. The motion lives in `studio.css`.
 */
function WorkingArc() {
  return (
    <svg
      data-working-indicator
      aria-hidden
      viewBox="0 0 36 36"
      className="patrol-working text-foreground/40 pointer-events-none absolute -inset-[3px] size-[calc(100%+6px)]"
    >
      <circle
        cx="18"
        cy="18"
        r="17.25"
        pathLength="100"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        className="patrol-working-arc"
      />
    </svg>
  );
}

function PatrollerRow({
  patroller,
  now,
  inDraft,
  singleLocale,
  open,
  onOpenChange,
  onShow,
  onApply,
  onAsk,
  onDismiss,
  patrolDraft,
  onOpenPatrolDraft,
}: {
  patroller: PatrollerView;
  now: number;
  inDraft: boolean;
  singleLocale: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onShow: (shown: Shown) => void;
  onApply: (finding: FindingView) => void;
  onAsk: (patroller: PatrollerView, finding: FindingView) => void;
  onDismiss: (finding: FindingView) => void;
  patrolDraft: PatrolDraft | null;
  onOpenPatrolDraft: (draft: PatrolDraft, finding: FindingView) => void;
}) {
  const statusId = React.useId();
  const working = patroller.working && workingSentence(patroller.id, patroller.working);
  const count = patroller.findings.length;
  return (
    <li data-patroller={patroller.id} data-open={open || undefined} className="flex justify-center">
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger
          aria-describedby={working ? statusId : undefined}
          className="group/patroller flex max-w-full min-w-0 cursor-pointer flex-col items-center gap-1 pt-[3px] outline-none"
        >
          {/* Grows a little under the pointer and gives under a press, like an app on a watch. */}
          <span className="relative flex size-10 shrink-0 transition-[scale] duration-200 ease-out group-hover/patroller:scale-105 group-active/patroller:scale-95 motion-reduce:transition-none">
            {/* Its story ring, clear of the avatar: drawn while it has findings to look at, a
                travelling arc while it works, and faint otherwise. */}
            {!working && (
              <span
                aria-hidden
                className={cn(
                  "group-focus-visible/patroller:ring-ring/50 pointer-events-none absolute -inset-[3px] rounded-full border group-focus-visible/patroller:ring-[3px]",
                  count > 0 ? "border-foreground border-[1.5px]" : "border-border",
                )}
              />
            )}
            {working && <WorkingArc />}
            <span className="bg-muted group-hover/patroller:bg-muted-foreground/15 group-data-popup-open/patroller:bg-muted-foreground/15 flex size-full items-center justify-center rounded-full transition-colors">
              <Squareling
                variant={patroller.id}
                status={working ? "working" : patroller.duty === "off" ? "asleep" : "idle"}
                className="size-6"
              />
            </span>
            {/* Its open findings, counted like an unread badge, cut out of the ring. */}
            {count > 0 && (
              <span
                data-findings-count
                aria-label={`${count} open ${count === 1 ? "finding" : "findings"}`}
                className="bg-foreground text-background ring-background absolute -top-1.5 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-medium tabular-nums ring-2"
              >
                {count}
              </span>
            )}
          </span>
          <span
            data-patroller-role
            className="max-w-full truncate text-[11px] leading-4 font-medium"
          >
            {patroller.role}
          </span>
        </PopoverTrigger>
        <PopoverContent sideOffset={8} className="w-96 gap-3 p-4">
          <PatrollerCard
            patroller={patroller}
            now={now}
            inDraft={inDraft}
            singleLocale={singleLocale}
            onShow={onShow}
            onApply={onApply}
            onAsk={(finding) => onAsk(patroller, finding)}
            onDismiss={onDismiss}
            patrolDraft={patrolDraft}
            onOpenPatrolDraft={onOpenPatrolDraft}
          />
        </PopoverContent>
      </Popover>
      {/* Announced as it changes, and read with the patroller as its description. Always there,
          empty while idle, so that starting work is announced too. */}
      <span id={statusId} data-working-status role="status" className="sr-only">
        {working && `Working: ${working.charAt(0).toLowerCase()}${working.slice(1)}`}
      </span>
    </li>
  );
}

/**
 * A patroller's popover, a profile card: its avatar and role, a tag of when it works where the
 * editor is over what it does, what it's on while it works, then what it did.
 */
export function PatrollerCard({
  singleLocale,
  ...props
}: React.ComponentProps<typeof PatrollerDetails> & { singleLocale: boolean }) {
  const { patroller, inDraft } = props;
  const working = patroller.working && workingSentence(patroller.id, patroller.working);
  const when = whenTag(patroller.id, patroller.duty, inDraft, singleLocale);
  return (
    <>
      <header className="flex items-center gap-3">
        <span className="bg-muted relative flex size-12 shrink-0 items-center justify-center rounded-full">
          <Squareling
            variant={patroller.id}
            status={working ? "working" : patroller.duty === "off" ? "asleep" : "idle"}
            className="size-7"
          />
          {working && <WorkingArc />}
        </span>
        <PopoverTitle className="min-w-0 text-base">{patroller.role}</PopoverTitle>
      </header>
      <div className="flex flex-col items-start gap-1.5">
        <span
          data-patroller-when
          className="bg-muted text-muted-foreground inline-flex items-center gap-1.5 rounded-full py-0.5 pr-2.5 pl-2 text-xs font-medium"
        >
          {/* Green while it runs where the editor is, grey where it doesn't. */}
          <span
            aria-hidden
            className={cn(
              "size-1.5 rounded-full",
              when.runs ? "bg-emerald-500" : "bg-muted-foreground/40",
            )}
          />
          {when.label}
        </span>
        <p data-patroller-about className="text-sm">
          {aboutSentence(patroller.id)}
        </p>
      </div>
      {working && (
        <p data-patroller-working className="bg-muted rounded-md px-2.5 py-1.5 text-xs">
          {working}
        </p>
      )}
      <div className="flex flex-col gap-2 border-t pt-3">
        <PatrollerDetails {...props} />
      </div>
    </>
  );
}

/**
 * What a patroller's popover shows: its open findings with their actions, then its reports, then
 * the history of its dismissals.
 */
export function PatrollerDetails({
  patroller,
  now,
  inDraft,
  onShow,
  onApply,
  onAsk,
  onDismiss,
  patrolDraft,
  onOpenPatrolDraft,
}: {
  patroller: PatrollerView;
  now: number;
  inDraft: boolean;
  onShow: (shown: Shown) => void;
  onApply: (finding: FindingView) => void;
  /** Fills the draft's chat with the finding, for the agent. */
  onAsk: (finding: FindingView) => void;
  onDismiss: (finding: FindingView) => void;
  /** The project's open Patrol Draft, where Live's findings are fixed, if any. */
  patrolDraft: PatrolDraft | null;
  onOpenPatrolDraft: (draft: PatrolDraft, finding: FindingView) => void;
}) {
  return (
    <>
      {patroller.findings.length > 0 && (
        <ul data-findings={patroller.id} className="flex flex-col gap-2 text-xs">
          {patroller.findings.map((finding) => (
            <li key={finding.id} data-finding className="flex flex-col gap-1">
              <span className="flex items-baseline gap-2">
                <span data-finding-sentence className="min-w-0 flex-1">
                  {findingSentence(finding)}
                </span>
                {inDraft && finding.live && (
                  <Badge variant="outline" size="sm">
                    Live
                  </Badge>
                )}
              </span>
              <span className="flex flex-wrap gap-1">
                {finding.place && (
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() => onShow(shownOfFinding(finding))}
                  >
                    Show
                  </Button>
                )}
                {/* Live's findings are fixed in the Patrol Draft. */}
                {finding.fix && !finding.live && (
                  <Button variant="outline" size="xs" onClick={() => onApply(finding)}>
                    {fixLabel(finding.fix)}
                  </Button>
                )}
                {inDraft && !finding.live && (
                  <Button variant="outline" size="xs" onClick={() => onAsk(finding)}>
                    Ask the agent
                  </Button>
                )}
                {/* On Live, a finding leads to the Patrol Draft, where Camox's agent fixes it. */}
                {!inDraft && patrolDraft && (
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() => onOpenPatrolDraft(patrolDraft, finding)}
                  >
                    Open the Patrol Draft
                  </Button>
                )}
                <Button variant="ghost" size="xs" onClick={() => onDismiss(finding)}>
                  {dismissLabel(finding.about)}
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <PatrollerReports patroller={patroller} now={now} inDraft={inDraft} onShow={onShow} />
      {patroller.dismissals.length > 0 && (
        <ul
          data-dismissals={patroller.id}
          aria-label="Dismissed"
          className="text-muted-foreground flex flex-col gap-1 border-t pt-2 text-xs"
        >
          {patroller.dismissals.map((dismissal) => (
            <li key={dismissal.id} data-dismissal className="flex items-baseline gap-2">
              <span className="min-w-0 flex-1">
                {`${dismissedSentence(dismissal.about)}: dismissed by ${dismissal.by.name}`}
              </span>
              <time dateTime={new Date(dismissal.at).toISOString()} className="shrink-0">
                {shortTimeAgo(dismissal.at, now)}
              </time>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/**
 * A patroller's reports, latest first, each with a Live tag when a draft is viewed and how long
 * ago, then how many more there are, by locale.
 */
export function PatrollerReports({
  patroller,
  now,
  inDraft,
  onShow,
}: {
  patroller: PatrollerView;
  now: number;
  inDraft: boolean;
  onShow: (shown: Shown) => void;
}) {
  if (patroller.reports.length === 0 && patroller.more.length === 0) {
    // Its findings and dismissals say it did something.
    if (patroller.findings.length > 0 || patroller.dismissals.length > 0) return null;
    return <p className="text-muted-foreground text-xs">Nothing yet.</p>;
  }
  return (
    <ul data-reports={patroller.id} className="flex flex-col gap-1 text-xs">
      {patroller.reports.map((report) => (
        <li
          key={report.id}
          data-report
          className="has-focus-visible:ring-ring/50 has-[button:hover]:bg-muted/60 relative -mx-1.5 flex items-baseline gap-2 rounded-sm px-1.5 py-0.5 has-focus-visible:ring-[3px]"
        >
          <ReportSentence report={report} inDraft={inDraft} onShow={onShow} />
          {inDraft && report.live && (
            <Badge variant="outline" size="sm">
              Live
            </Badge>
          )}
          <time
            dateTime={new Date(report.at).toISOString()}
            className="text-muted-foreground shrink-0"
          >
            {shortTimeAgo(report.at, now)}
          </time>
        </li>
      ))}
      {patroller.more.length > 0 && (
        <li data-more className="text-muted-foreground">
          {moreSentence(patroller.more)}
        </li>
      )}
    </ul>
  );
}

/**
 * A report's sentence: a button showing its subject where it is, over the whole row, named for
 * where it leads. A report without a place is plain text.
 */
function ReportSentence({
  report,
  inDraft,
  onShow,
}: {
  report: ReportView;
  inDraft: boolean;
  onShow: (shown: Shown) => void;
}) {
  const sentence = reportSentence(report.summary, report.outcome);
  const leads = whereReportLeads(report, inDraft);
  if (leads === null) return <span className="min-w-0 flex-1">{sentence}</span>;
  return (
    <button
      type="button"
      aria-label={`${sentence}: ${leads}`}
      onClick={() => onShow(shownOf(report))}
      className="min-w-0 flex-1 cursor-pointer text-left outline-none after:absolute after:inset-0"
    >
      {sentence}
    </button>
  );
}
