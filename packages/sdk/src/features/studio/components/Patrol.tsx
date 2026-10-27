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
  if (!view) return null;
  return (
    <PatrolRoster
      view={view}
      now={now}
      inDraft={inDraft}
      singleLocale={locales?.length === 1}
      expanded={expanded}
      onToggle={toggle}
    />
  );
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
}: {
  view: PatrolView;
  now: number;
  inDraft: boolean;
  singleLocale: boolean;
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
          idle={
            patroller.id === "translator" && singleLocale
              ? "Add a language to translate into"
              : undefined
          }
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
  idle,
  expanded,
  onToggle,
}: {
  patroller: PatrollerView;
  now: number;
  inDraft: boolean;
  /** What the patroller says while idle instead of when it last worked. */
  idle: string | undefined;
  expanded: boolean;
  onToggle: () => void;
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
