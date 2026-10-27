import type { PatrollerId, PatrollerView, PatrolView } from "@camox/api-contract/patrol";
import { Badge } from "@camox/ui/badge";
import * as React from "react";

import { AuthContext } from "../../../lib/auth";
import { useCurrentDraftId } from "../../../lib/draft-scope";
import { reads, useReadQuery } from "../../../lib/studio-reads";
import { cn } from "../../../lib/utils";
import { BOTTOM_CARD_EDGES, CARD_BODY_EDGES } from "../../preview/components/SidebarStack";
import { timeAgo } from "../draftLabel";
import { moreSentence, reportSentence, shortTimeAgo } from "../reportSentence";
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
        expanded={expanded}
        onToggle={toggle}
      />
    </div>
  );
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
 * and the reports of the expanded ones. Live's reports carry a tag when a draft is viewed.
 */
export function PatrolRoster({
  view,
  now,
  inDraft,
  expanded,
  onToggle,
}: {
  view: PatrolView;
  now: number;
  inDraft: boolean;
  expanded: ReadonlySet<string>;
  onToggle: (id: PatrollerId) => void;
}) {
  return (
    <ul className="flex flex-col py-1">
      {view.patrollers.map((patroller) => (
        <PatrollerRow
          key={patroller.id}
          patroller={patroller}
          now={now}
          inDraft={inDraft}
          expanded={expanded.has(patroller.id)}
          onToggle={() => onToggle(patroller.id)}
        />
      ))}
    </ul>
  );
}

function PatrollerRow({
  patroller,
  now,
  inDraft,
  expanded,
  onToggle,
}: {
  patroller: PatrollerView;
  now: number;
  inDraft: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const reportsId = React.useId();
  const subtitle = patroller.lastActivityAt === null ? "" : timeAgo(patroller.lastActivityAt, now);
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
            <li key={report.id} data-report className="flex items-baseline gap-2">
              <span className="min-w-0 flex-1">
                {reportSentence(report.summary, report.outcome)}
              </span>
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
