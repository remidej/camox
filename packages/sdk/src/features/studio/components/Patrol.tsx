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
import { timeAgo } from "../draftLabel";
import {
  askAgentMessage,
  dismissLabel,
  dismissedSentence,
  findingSentence,
  fixLabel,
} from "../findingSentence";
import { moreSentence, reportSentence, shortTimeAgo, whereReportLeads } from "../reportSentence";
import { editCollectionItemPath } from "../routes";
import { useShowInCanvas } from "../showInCanvas";
import { studioStore } from "../studioStore";
import { singleLocaleSentence, workingSentence } from "../workingSentence";
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
      <div className={cn("bg-background min-h-0 flex-1 overflow-y-auto", CARD_BODY_EDGES)}>
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
  // While the pointer is over the Patrol, or a patroller's reports are open, its order holds, so a
  // report doesn't move away just as it's about to be clicked. Then the latest order applies.
  const [heldOrder, setHeldOrder] = React.useState<readonly PatrollerId[] | null>(null);
  const pointerIn = React.useRef(false);
  const shown = view && inHeldOrder(view, heldOrder);
  const roster = useMovingRows(shown?.patrollers.map(({ id }) => id).join(" "));
  const [openFileId, setOpenFileId] = React.useState<string | null>(null);
  const showReport = useShowReport(inDraft, setOpenFileId);
  const applyFix = useMutation(patrolMutations.applyFix());
  const dismissFinding = useMutation(patrolMutations.dismissFinding());
  if (!shown) return null;
  const hold = () => setHeldOrder((held) => held ?? shown.patrollers.map(({ id }) => id));
  const openReports = (id: PatrollerId | null) => {
    setOpen(id);
    if (id) hold();
    else if (!pointerIn.current) setHeldOrder(null);
  };
  return (
    <div
      ref={roster}
      className="relative"
      onPointerEnter={() => {
        pointerIn.current = true;
        hold();
      }}
      onPointerLeave={() => {
        pointerIn.current = false;
        if (!open) setHeldOrder(null);
      }}
    >
      <PatrolRoster
        view={shown}
        now={now}
        inDraft={inDraft}
        singleLocale={locales?.length === 1}
        open={open}
        onOpenChange={openReports}
        onShow={(shown) => {
          // Showing it moves the editor on, which leaves the reports.
          openReports(null);
          showReport(shown);
        }}
        onApply={(finding) => applyFix.mutate({ projectId, findingId: finding.id })}
        onAsk={(patroller, finding) => {
          // The chat takes over from the popover.
          openReports(null);
          studioStore.trigger.askAgent({ text: askAgentMessage(finding, patroller.role) });
        }}
        onDismiss={(finding) => dismissFinding.mutate({ projectId, findingId: finding.id })}
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

/** What the Patrol shows where it is: a report's or a finding's subject, in its locale. */
export type Shown = { place: ReportPlace | null; live: boolean; locale: string | null };

/** A report, as the Patrol shows its subject. */
const shownOf = (report: ReportView): Shown => ({
  ...report,
  locale: reportLocale(report.summary),
});

/**
 * Shows a report's or a finding's subject where it is, in its locale, and on Live for a Live one
 * seen from a draft: a page, block or item selected on the Canvas, a record in its collection, or
 * a file, opened over the Canvas.
 */
function useShowReport(inDraft: boolean, openFile: (fileId: string) => void) {
  const showInCanvas = useShowInCanvas();
  const navigate = useNavigate();
  const view = useViewLocale();
  return (report: Shown) => {
    const { place } = report;
    if (!place) return;
    const toLive = inDraft && report.live ? { draft: null } : {};
    const tag = report.locale;
    if (place.kind === "page") {
      const { pageId, blockId, itemId } = place;
      return void showInCanvas({ pageId, locale: tag, blockId, itemId, ...toLive });
    }
    if (place.kind === "record") {
      const locale = view.locales.find((each) => each.tag === tag) ?? view.locale;
      const path = editCollectionItemPath(place.collectionId, place.recordId);
      return void navigate({ to: localizedPath(path, locale), ...toLive });
    }
    if (inDraft && report.live) void navigate({ to: window.location.href, draft: null });
    openFile(place.fileId);
  };
}

/**
 * The view with its patrollers in the order held, if any, and its latest content: patrollers the
 * order doesn't hold follow, in the view's order, and those no longer in the view are dropped.
 */
export function inHeldOrder(view: PatrolView, order: readonly PatrollerId[] | null): PatrolView {
  if (!order) return view;
  const place = (id: PatrollerId) => {
    const index = order.indexOf(id);
    return index === -1 ? order.length : index;
  };
  // A stable sort keeps the view's order among the patrollers the order doesn't hold.
  return { ...view, patrollers: [...view.patrollers].sort((a, b) => place(a.id) - place(b.id)) };
}

/** How long a patroller takes to move to its new place, in ms. */
const MOVE_DURATION = 250;
/** A strong ease-out: the move starts at once and settles gently. */
const MOVE_EASING = "cubic-bezier(0.23, 1, 0.32, 1)";

/**
 * Moves each patroller from where it showed to its new place when the order (a key of their ids)
 * changes, rather than jumping there. Without motion for editors who reduce it.
 */
function useMovingRows(order: string | undefined) {
  const node = React.useRef<HTMLDivElement>(null);
  /** Where each patroller showed, as of the last render, and in which order. */
  const last = React.useRef<{ order: string | undefined; tops: Map<string, number> }>(null);
  React.useLayoutEffect(() => {
    const roster = node.current;
    if (!roster) return;
    const rows = [...roster.querySelectorAll<HTMLElement>("[data-patroller]")];
    const tops = new Map(rows.map((row) => [row.dataset.patroller!, row.offsetTop]));
    const previous = last.current;
    last.current = { order, tops };
    if (!previous || previous.order === order) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    for (const row of rows) {
      const from = previous.tops.get(row.dataset.patroller!);
      const to = tops.get(row.dataset.patroller!)!;
      if (from === undefined || from === to) continue;
      row.animate([{ transform: `translateY(${from - to}px)` }, { transform: "none" }], {
        duration: MOVE_DURATION,
        easing: MOVE_EASING,
      });
    }
  });
  return node;
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
 * A `PatrolView`, in the order it gives: each patroller's avatar, role, and when it last worked,
 * opening its reports in a popover to the left. Live's reports carry a tag when a draft is viewed. In a
 * project with a single locale, the Translator invites the editor to add a language instead.
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
}) {
  return (
    <ul className="flex flex-col gap-px p-1">
      {view.patrollers.map((patroller) => (
        <PatrollerRow
          key={patroller.id}
          patroller={patroller}
          now={now}
          inDraft={inDraft}
          idle={singleLocale ? singleLocaleSentence(patroller.id) : undefined}
          open={open === patroller.id}
          onOpenChange={(next) => onOpenChange(next ? patroller.id : null)}
          onShow={onShow}
          onApply={onApply}
          onAsk={onAsk}
          onDismiss={onDismiss}
        />
      ))}
    </ul>
  );
}

/**
 * A thin, low-contrast arc travelling around a working patroller's avatar circle, or the whole
 * circle pulsing slowly under reduced motion. The motion lives in `studio.css`.
 */
function WorkingArc() {
  return (
    <svg
      data-working-indicator
      aria-hidden
      viewBox="0 0 32 32"
      className="patrol-working text-foreground/30 pointer-events-none absolute inset-0 size-full"
    >
      <circle
        cx="16"
        cy="16"
        r="15.25"
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
  idle,
  open,
  onOpenChange,
  onShow,
  onApply,
  onAsk,
  onDismiss,
}: {
  patroller: PatrollerView;
  now: number;
  inDraft: boolean;
  /** What the patroller says while idle instead of when it last worked. */
  idle: string | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onShow: (shown: Shown) => void;
  onApply: (finding: FindingView) => void;
  onAsk: (patroller: PatrollerView, finding: FindingView) => void;
  onDismiss: (finding: FindingView) => void;
}) {
  const statusId = React.useId();
  const working = patroller.working && workingSentence(patroller.id, patroller.working);
  // One that checks at publish says so: its check is coming.
  const subtitle =
    working ??
    idle ??
    (patroller.duty === "atPublish" ? "Checks when you publish" : undefined) ??
    (patroller.lastActivityAt === null ? "" : timeAgo(patroller.lastActivityAt, now));
  const count = patroller.findings.length;
  return (
    <li data-patroller={patroller.id} data-open={open || undefined} className="flex flex-col">
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger
          aria-describedby={working ? statusId : undefined}
          // A card of its own on hover, and while its reports are open.
          className="hover:bg-muted/60 data-popup-open:bg-muted/60 focus-visible:ring-ring/50 flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-left outline-none focus-visible:ring-[3px]"
        >
          <span className="bg-muted relative flex size-8 shrink-0 items-center justify-center rounded-full">
            <Squareling
              variant={patroller.id}
              status={working ? "working" : patroller.duty === "off" ? "asleep" : "idle"}
              className="size-5"
            />
            {working && <WorkingArc />}
          </span>
          <span className="flex min-w-0 flex-col">
            <span data-patroller-role className="truncate text-sm font-medium">
              {patroller.role}
            </span>
            <span
              data-patroller-subtitle
              aria-hidden={working ? true : undefined}
              className="text-muted-foreground truncate text-xs"
            >
              {subtitle}
            </span>
          </span>
          {/* Its open findings, counted like unread messages from a colleague. */}
          {count > 0 && (
            <span
              data-findings-count
              aria-label={`${count} open ${count === 1 ? "finding" : "findings"}`}
              className="bg-foreground text-background ml-auto flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-xs font-medium tabular-nums"
            >
              {count}
            </span>
          )}
        </PopoverTrigger>
        {/* To the left, over the Canvas, clear of the sidebar's card around the roster. */}
        <PopoverContent side="left" align="start" sideOffset={12} className="w-80 gap-2 p-3">
          <PopoverTitle className="text-sm">{patroller.role}</PopoverTitle>
          <PatrollerDetails
            patroller={patroller}
            now={now}
            inDraft={inDraft}
            onShow={onShow}
            onApply={onApply}
            onAsk={(finding) => onAsk(patroller, finding)}
            onDismiss={onDismiss}
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
}: {
  patroller: PatrollerView;
  now: number;
  inDraft: boolean;
  onShow: (shown: Shown) => void;
  onApply: (finding: FindingView) => void;
  /** Fills the draft's chat with the finding, for the agent. */
  onAsk: (finding: FindingView) => void;
  onDismiss: (finding: FindingView) => void;
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
                  <Button variant="outline" size="xs" onClick={() => onShow(finding)}>
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
