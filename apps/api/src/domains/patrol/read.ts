import {
  type PatrollerView,
  type PatrolView,
  type ReportEntity,
  type ReportSummary,
  REPORTS_SHOWN,
  type ReportView,
} from "@camox/api-contract/patrol";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { Effect } from "effect";
import { z } from "zod";

import type { Database } from "../../db";
import { decodeInput } from "../../lib/errors";
import type { ServiceContext } from "../_shared/service-context";
import { selectInChunks } from "../content/chunks";
import { accessTo } from "../drafts/access";
import { catchUpDraftOf } from "../drafts/catch-up";
import {
  draftIn,
  draftOf,
  type Draft,
  inDefaultLocale,
  inLocale,
  type ReadScope,
} from "../drafts/scope";
import { withFileMetadata } from "../files/generated-metadata";
import { files } from "../files/schema";
import { defaultLocaleTag } from "../locales/default-locale";
import { pages } from "../pages/schema";
import { PATROLLERS } from "./patrollers";
import { reports } from "./schema";

// The Patrol read (ADR 0024): every patroller of the registry, with its reports in the scope the
// studio views. A draft sees its own reports and Live's; Live sees its own. The catch-up draft's
// reports are Live's (ADR 0017): it exists only to bring Live's translations up to date.
// Reports name their subjects as they are now, and are left out once their subject is gone from
// their scope and locale.

export const getPatrolInput = z.object({ projectId: z.number() });

type ReportRow = typeof reports.$inferSelect;

/**
 * Names the subjects of one entity a scope holds, by id: those it doesn't hold have no name. Each
 * entity a report can be about has one.
 */
type Namer = (
  db: Database,
  scope: ReadScope,
  ids: readonly string[],
) => Effect.Effect<Map<string, string>>;

const NAMERS: Partial<Record<ReportEntity, Namer>> = {
  page: (db, scope, ids) =>
    Effect.map(
      selectInChunks(db, scope, pages, ids, (chunk) => inArray(pages.id, chunk)),
      (rows) => new Map(rows.map((page) => [page.id, page.nickname])),
    ),
  // Files aren't localized: a file's name is its filename in the default locale.
  file: (db, scope, ids) =>
    Effect.gen(function* () {
      const inDefault = inDefaultLocale(scope);
      const rows = yield* selectInChunks(db, inDefault, files, ids, (chunk) =>
        inArray(files.id, chunk),
      );
      const shown = yield* withFileMetadata(db, inDefault, rows);
      return new Map(
        shown.map((file) => [file.id, file.filename || file.url.split("/").pop() || file.id]),
      );
    }),
};

/** A report's structured subject, if it has one. */
const subjectOf = (row: ReportRow) =>
  row.summary.kind === "structured" ? row.summary.subject : null;

const localeOfRow = (row: ReportRow) =>
  row.summary.kind === "structured" ? row.summary.locale : null;

/**
 * The names of the reports' subjects, by report, in each report's scope and locale. Reports
 * without a subject have none; those whose subject is gone are missing.
 */
const nameSubjects = Effect.fn("patrol.nameSubjects")(function* (
  db: Database,
  projectId: number,
  rows: readonly ReportRow[],
  draftsById: ReadonlyMap<string, Draft>,
) {
  const defaultTag = yield* defaultLocaleTag(db, projectId);
  const groups = new Map<string, { scope: ReadScope; entity: ReportEntity; rows: ReportRow[] }>();
  for (const row of rows) {
    const subject = subjectOf(row);
    if (!subject) continue;
    const locale = localeOfRow(row);
    const draft = row.draftId === null ? null : draftsById.get(row.draftId);
    if (draft === undefined) continue;
    const scope: ReadScope =
      locale === null || locale === defaultTag ? draft : inLocale(draft, locale);
    const key = `${row.draftId}\u0000${locale}\u0000${subject.entity}`;
    const group = groups.get(key) ?? { scope, entity: subject.entity, rows: [] };
    group.rows.push(row);
    groups.set(key, group);
  }
  const names = new Map<ReportRow, string>();
  for (const group of groups.values()) {
    const namer = NAMERS[group.entity];
    if (!namer) continue;
    const named = yield* namer(
      db,
      group.scope,
      group.rows.map((row) => subjectOf(row)!.id),
    );
    for (const row of group.rows) {
      const name = named.get(subjectOf(row)!.id);
      if (name !== undefined) names.set(row, name);
    }
  }
  return names;
});

/** Newest first; a report written later wins a tie. */
const newestFirst = (a: ReportRow, b: ReportRow) => b.at - a.at || b.rowId - a.rowId;

/** The Patrol of the scope the request names. */
export const getPatrol = Effect.fn("patrol.get")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof getPatrolInput>,
) {
  const { projectId } = yield* decodeInput(getPatrolInput, rawInput);
  const { scope } = yield* accessTo(ctx, { project: projectId }, "member");
  const viewed = draftIn(scope);
  const catchUp = yield* catchUpDraftOf(ctx.db, projectId);
  const draftsById = new Map<string, Draft>();
  if (catchUp) draftsById.set(catchUp.id, draftOf(catchUp));
  if (viewed) draftsById.set(viewed.id, draftOf(viewed));

  const rows = yield* Effect.promise(() =>
    ctx.db
      .select()
      .from(reports)
      .where(
        and(
          eq(reports.projectId, projectId),
          draftsById.size > 0
            ? or(isNull(reports.draftId), inArray(reports.draftId, [...draftsById.keys()]))
            : isNull(reports.draftId),
        ),
      ),
  );
  const names = yield* nameSubjects(ctx.db, projectId, rows, draftsById);
  // Reports about a subject that's gone are left out.
  const shown = rows.filter((row) => subjectOf(row) === null || names.has(row));

  const viewOf = (row: ReportRow): ReportView => {
    const summary: ReportSummary =
      row.summary.kind === "text"
        ? row.summary
        : {
            ...row.summary,
            subject: row.summary.subject && { ...row.summary.subject, name: names.get(row)! },
          };
    return {
      id: `${row.draftId ?? "live"}:${row.key}`,
      summary,
      outcome: row.outcome,
      attention: row.attention,
      at: row.at,
      // Live's own, or the catch-up draft's unless that's the draft viewed.
      live: row.draftId === null || row.draftId !== viewed?.id,
    };
  };

  const patrollers = PATROLLERS.map((patroller): PatrollerView => {
    const own = shown.filter((row) => row.patroller === patroller.id).sort(newestFirst);
    const rest = new Map<string | null, number>();
    for (const row of own.slice(REPORTS_SHOWN)) {
      rest.set(localeOfRow(row), (rest.get(localeOfRow(row)) ?? 0) + 1);
    }
    return {
      id: patroller.id,
      role: patroller.role,
      working: null,
      lastActivityAt: own[0]?.at ?? null,
      reports: own.slice(0, REPORTS_SHOWN).map(viewOf),
      more: [...rest]
        .map(([locale, count]) => ({ locale, count }))
        .sort((a, b) => b.count - a.count || (a.locale ?? "").localeCompare(b.locale ?? "")),
    };
  });
  // The latest activity first, those that never worked last, in the registry's order.
  const order = (patroller: PatrollerView) => patroller.lastActivityAt ?? 0;
  return { patrollers: patrollers.sort((a, b) => order(b) - order(a)) } satisfies PatrolView;
}, Effect.scoped);
