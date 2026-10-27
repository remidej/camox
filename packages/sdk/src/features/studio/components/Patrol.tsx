import type {
  PatrollerId,
  PatrollerView,
  PatrolView,
  ReportView,
} from "@camox/api-contract/patrol";
import { Badge } from "@camox/ui/badge";
import * as React from "react";

import { AuthContext } from "../../../lib/auth";
import { useCurrentDraftId } from "../../../lib/draft-scope";
import { localizedPath } from "../../../lib/locale-path";
import { reads, useReadQuery } from "../../../lib/studio-reads";
import { cn } from "../../../lib/utils";
import { useViewLocale } from "../../../lib/view-locale-context";
import { useNavigate } from "../../navigation/navigation";
import { AssetLightbox } from "../../preview/components/AssetLightbox";
import { BOTTOM_CARD_EDGES, CARD_BODY_EDGES } from "../../preview/components/SidebarStack";
import { timeAgo } from "../draftLabel";
import { moreSentence, reportSentence, shortTimeAgo, whereReportLeads } from "../reportSentence";
import { editCollectionItemPath } from "../routes";
import { useShowInCanvas } from "../showInCanvas";
import { Squareling } from "./Squareling";

/**
 * The Agent Sidebar's Patrol, over the Chat widget: every patroller of the project, and what each
 * did without being asked in the draft viewed, or on Live (ADR 0024). It fetches the Patrol of the
 * scope viewed, and holds which patrollers are expanded.
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
  // Each patroller keeps its own state, whatever its place in the roster.
  const [expanded, setExpanded] = React.useState<ReadonlySet<PatrollerId>>(new Set());
  const toggle = (id: PatrollerId) =>
    setExpanded((previous) => {
      const next = new Set(previous);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  // The relative times move on while the Patrol stays open.
  const now = useNow(30_000);
  // While the pointer is over the Patrol, its order holds, so a report doesn't move away just as
  // it's about to be clicked. Leaving applies the latest order.
  const [heldOrder, setHeldOrder] = React.useState<readonly PatrollerId[] | null>(null);
  const shown = view && inHeldOrder(view, heldOrder);
  const roster = useMovingRows(shown?.patrollers.map(({ id }) => id).join(" "));
  const [openFileId, setOpenFileId] = React.useState<string | null>(null);
  const show = useShowReport(inDraft, setOpenFileId);
  if (!shown) return null;
  return (
    <div
      ref={roster}
      className="relative"
      onPointerEnter={() => setHeldOrder(shown.patrollers.map(({ id }) => id))}
      onPointerLeave={() => setHeldOrder(null)}
    >
      <PatrolRoster
        view={shown}
        now={now}
        inDraft={inDraft}
        singleLocale={locales?.length === 1}
        expanded={expanded}
        onToggle={toggle}
        onShow={show}
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

/**
 * Shows a report's subject where it is, in the report's locale, and on Live for a Live report seen
 * from a draft: a page, block or item selected on the Canvas, a record in its collection, or a
 * file, opened over the Canvas.
 */
function useShowReport(inDraft: boolean, openFile: (fileId: string) => void) {
  const showInCanvas = useShowInCanvas();
  const navigate = useNavigate();
  const view = useViewLocale();
  return (report: ReportView) => {
    const { place } = report;
    if (!place) return;
    const toLive = inDraft && report.live ? { draft: null } : {};
    const tag = report.summary.kind === "structured" ? report.summary.locale : null;
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
 * and the reports of the expanded ones. Live's reports carry a tag when a draft is viewed. In a
 * project with a single locale, the Translator invites the editor to add a language instead.
 */
export function PatrolRoster({
  view,
  now,
  inDraft,
  singleLocale,
  expanded,
  onToggle,
  onShow,
}: {
  view: PatrolView;
  now: number;
  inDraft: boolean;
  singleLocale: boolean;
  expanded: ReadonlySet<string>;
  onToggle: (id: PatrollerId) => void;
  /** Shows a report's subject where it is: one with a place only. */
  onShow: (report: ReportView) => void;
}) {
  return (
    <ul className="flex flex-col py-1">
      {view.patrollers.map((patroller) => (
        <PatrollerRow
          key={patroller.id}
          patroller={patroller}
          now={now}
          inDraft={inDraft}
          idle={
            patroller.id === "translator" && singleLocale
              ? "Add a language to translate into"
              : undefined
          }
          expanded={expanded.has(patroller.id)}
          onToggle={() => onToggle(patroller.id)}
          onShow={onShow}
        />
      ))}
    </ul>
  );
}

function PatrollerRow({
  patroller,
  now,
  inDraft,
  idle,
  expanded,
  onToggle,
  onShow,
}: {
  patroller: PatrollerView;
  now: number;
  inDraft: boolean;
  /** What the patroller says while idle instead of when it last worked. */
  idle: string | undefined;
  expanded: boolean;
  onToggle: () => void;
  onShow: (report: ReportView) => void;
}) {
  const reportsId = React.useId();
  const subtitle =
    idle ?? (patroller.lastActivityAt === null ? "" : timeAgo(patroller.lastActivityAt, now));
  return (
    <li data-patroller={patroller.id} className="flex flex-col">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={reportsId}
        onClick={onToggle}
        className="hover:bg-muted/60 focus-visible:ring-ring/50 flex items-center gap-2.5 px-3 py-1.5 text-left outline-none focus-visible:ring-[3px]"
      >
        <span className="bg-muted flex size-8 shrink-0 items-center justify-center rounded-full">
          <Squareling status="idle" className="size-5" />
        </span>
        <span className="flex min-w-0 flex-col">
          <span data-patroller-role className="truncate text-sm font-medium">
            {patroller.role}
          </span>
          <span data-patroller-subtitle className="text-muted-foreground truncate text-xs">
            {subtitle}
          </span>
        </span>
      </button>
      {expanded && (
        <ul id={reportsId} className="flex flex-col gap-1 pt-0.5 pr-3 pb-2 pl-[3.375rem] text-xs">
          {patroller.reports.map((report) => (
            <li
              key={report.id}
              data-report
              className="has-focus-visible:ring-ring/50 has-[button:hover]:bg-muted/60 relative -mx-1.5 flex items-baseline gap-2 rounded-sm px-1.5 has-focus-visible:ring-[3px]"
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
      )}
    </li>
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
  onShow: (report: ReportView) => void;
}) {
  const sentence = reportSentence(report.summary, report.outcome);
  const leads = whereReportLeads(report, inDraft);
  if (leads === null) return <span className="min-w-0 flex-1">{sentence}</span>;
  return (
    <button
      type="button"
      aria-label={`${sentence}: ${leads}`}
      onClick={() => onShow(report)}
      className="min-w-0 flex-1 cursor-pointer text-left outline-none after:absolute after:inset-0"
    >
      {sentence}
    </button>
  );
}
