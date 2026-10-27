import {
  type PatrollerView,
  type PatrollerWorking,
  type PatrolView,
  type ReportPlace,
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
import { blocks, collectionRecords, repeatableItems, sharedContents } from "../../schema";
import type { ServiceContext } from "../_shared/service-context";
import { selectInChunks } from "../content/chunks";
import { contentReader } from "../content/reader";
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
import type { PendingWork } from "./working";

// The Patrol read (ADR 0024): every patroller of the registry, with its reports in the scope the
// studio views. A draft sees its own reports and Live's; Live sees its own. The catch-up draft's
// reports are Live's (ADR 0017): it exists only to bring Live's translations up to date.
// Reports name their subjects as they are now, and are left out once their subject is gone from
// their scope and locale.

export const getPatrolInput = z.object({ projectId: z.number() });

type ReportRow = typeof reports.$inferSelect;

/** A subject a scope holds: its name, as the Canvas names it, and where the studio shows it. */
type Named = { name: string; place: ReportPlace | null };

/**
 * Names the subjects of one entity a scope holds, by id, and says where each shows: those it
 * doesn't hold have no name. Each entity a report can be about has one.
 */
type Namer = (
  db: Database,
  projectId: number,
  scope: ReadScope,
  ids: readonly string[],
) => Effect.Effect<Map<string, Named>>;

/** Where a page's block shows, with an item in it to select. A layout's block has no one page. */
const onPage = (
  block: { id: string; pageId: string | null } | undefined,
  itemId: string | null = null,
): ReportPlace | null =>
  block?.pageId ? { kind: "page", pageId: block.pageId, blockId: block.id, itemId } : null;

const NAMERS: Record<ReportEntity, Namer> = {
  page: (db, _projectId, scope, ids) =>
    Effect.map(
      selectInChunks(db, scope, pages, ids, (chunk) => inArray(pages.id, chunk)),
      (rows) =>
        new Map(
          rows.map((page) => [
            page.id,
            {
              name: page.nickname,
              place: { kind: "page", pageId: page.id, blockId: null, itemId: null },
            },
          ]),
        ),
    ),
  // Blocks and repeatable items by their summary, or their title until they have one.
  block: (db, projectId, scope, ids) =>
    Effect.gen(function* () {
      const rows = yield* selectInChunks(db, scope, blocks, ids, (chunk) =>
        inArray(blocks.id, chunk),
      );
      const shown = yield* contentReader({ db }, { projectId, draft: scope }).shown.blocks(rows);
      const byId = new Map(rows.map((block) => [block.id, block]));
      return new Map(
        shown.map((block) => [
          block.id,
          { name: block.summary || block.title || block.type, place: onPage(byId.get(block.id)) },
        ]),
      );
    }),
  // An item shows on its tree's block's page.
  repeatableItem: (db, projectId, scope, ids) =>
    Effect.gen(function* () {
      const rows = yield* selectInChunks(db, scope, repeatableItems, ids, (chunk) =>
        inArray(repeatableItems.id, chunk),
      );
      const shown = yield* contentReader({ db }, { projectId, draft: scope }).shown.items(rows);
      const blockIds = [...new Set(rows.flatMap((item) => (item.blockId ? [item.blockId] : [])))];
      const roots = yield* selectInChunks(db, scope, blocks, blockIds, (chunk) =>
        inArray(blocks.id, chunk),
      );
      const blockOf = new Map(rows.map((item) => [item.id, item.blockId]));
      const rootsById = new Map(roots.map((block) => [block.id, block]));
      return new Map(
        shown.map((item) => [
          item.id,
          {
            name: item.summary || item.title || item.fieldName,
            place: onPage(rootsById.get(blockOf.get(item.id) ?? ""), item.id),
          },
        ]),
      );
    }),
  // Shared content by the name of its synced block definition. It shows wherever it's placed.
  sharedContent: (db, projectId, scope, ids) =>
    Effect.gen(function* () {
      const rows = yield* selectInChunks(db, scope, sharedContents, ids, (chunk) =>
        inArray(sharedContents.id, chunk),
      );
      const reader = contentReader({ db }, { projectId, draft: scope });
      const names = new Map<string, Named>();
      for (const row of rows) {
        const name = (yield* reader.blockDefinition(row.type))?.title ?? row.type;
        names.set(row.id, { name, place: null });
      }
      return names;
    }),
  record: (db, projectId, scope, ids) =>
    Effect.gen(function* () {
      const rows = yield* selectInChunks(db, scope, collectionRecords, ids, (chunk) =>
        inArray(collectionRecords.id, chunk),
      );
      const reader = contentReader({ db }, { projectId, draft: scope });
      const names = new Map<string, Named>();
      for (const [collectionId, inCollection] of Map.groupBy(rows, (row) => row.collectionId)) {
        for (const record of yield* reader.shown.records(collectionId, inCollection)) {
          names.set(record.id, {
            name: record.title || record.id,
            place: { kind: "record", collectionId, recordId: record.id },
          });
        }
      }
      return names;
    }),
  // Files aren't localized: a file's name is its filename in the default locale.
  file: (db, _projectId, scope, ids) =>
    Effect.gen(function* () {
      const inDefault = inDefaultLocale(scope);
      const rows = yield* selectInChunks(db, inDefault, files, ids, (chunk) =>
        inArray(files.id, chunk),
      );
      const shown = yield* withFileMetadata(db, inDefault, rows);
      return new Map(
        shown.map((file) => [
          file.id,
          {
            name: file.filename || file.url.split("/").pop() || file.id,
            place: { kind: "file", fileId: file.id },
          },
        ]),
      );
    }),
};

/** A report's structured subject, if it has one. */
const subjectOf = (row: ReportRow) =>
  row.summary.kind === "structured" ? row.summary.subject : null;

const localeOfRow = (row: ReportRow) =>
  row.summary.kind === "structured" ? row.summary.locale : null;

/**
 * The names and places of the reports' subjects, by report, in each report's scope and locale. Reports
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
  const names = new Map<ReportRow, Named>();
  for (const group of groups.values()) {
    const named = yield* NAMERS[group.entity](
      db,
      projectId,
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

/**
 * What a patroller's pending work says it's on, and since when it's been on it: how many
 * subjects, with the one subject, named in the scope's default locale, when there's one, and
 * the locale when they share one.
 */
const workingOn = Effect.fn("patrol.workingOn")(function* (
  db: Database,
  projectId: number,
  pending: readonly PendingWork[],
  scope: Draft | null,
) {
  if (pending.length === 0) return { working: null, since: undefined };
  const since = Math.min(...pending.map((work) => work.requestedAt));
  const locales = new Set(pending.map((work) => work.locale));
  const locale = locales.size === 1 ? pending[0]!.locale : null;
  if (pending.length > 1) {
    return { working: { count: pending.length, subject: null, locale }, since };
  }
  const { entity, id } = pending[0]!;
  const name = (yield* NAMERS[entity](db, projectId, scope, [id])).get(id)?.name;
  const working: PatrollerWorking = {
    count: 1,
    subject: name === undefined ? null : { entity, id, name },
    locale,
  };
  return { working, since };
});

/** The latest of some times, or null when none is known. */
const latest = (...times: (number | undefined)[]) => {
  const known = times.filter((time) => time !== undefined);
  return known.length > 0 ? Math.max(...known) : null;
};

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
            subject: row.summary.subject && { ...row.summary.subject, name: names.get(row)!.name },
          };
    return {
      id: `${row.draftId ?? "live"}:${row.key}`,
      summary,
      outcome: row.outcome,
      attention: row.attention,
      at: row.at,
      // Live's own, or the catch-up draft's unless that's the draft viewed.
      live: row.draftId === null || row.draftId !== viewed?.id,
      place: names.get(row)?.place ?? null,
    };
  };

  // What's pending in the scope viewed: on Live, the catch-up draft's work is Live's.
  const workScopes = viewed ? [viewed.id] : [null, ...(catchUp ? [catchUp.id] : [])];
  const working = yield* Effect.forEach(PATROLLERS, (patroller) =>
    Effect.flatMap(patroller.pending(ctx.db, projectId, workScopes), (pending) =>
      workingOn(ctx.db, projectId, pending, viewed ? draftOf(viewed) : null),
    ),
  );

  const patrollers = PATROLLERS.map((patroller, index): PatrollerView => {
    const own = shown.filter((row) => row.patroller === patroller.id).sort(newestFirst);
    const rest = new Map<string | null, number>();
    for (const row of own.slice(REPORTS_SHOWN)) {
      rest.set(localeOfRow(row), (rest.get(localeOfRow(row)) ?? 0) + 1);
    }
    return {
      id: patroller.id,
      role: patroller.role,
      working: working[index]!.working,
      lastActivityAt: latest(own[0]?.at, working[index]!.since),
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
