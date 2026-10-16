import { and, eq, isNotNull } from "drizzle-orm";
import { Effect } from "effect";

import type { Database } from "../../db";
import { lexicalStateToPlainText } from "../../lib/lexical-state";
import { definitionsIn } from "../_shared/definitions";
import type { DraftScope } from "../drafts/scope";
import { layouts } from "../layouts/schema";

// Record pages (GLOSSARY): pages of a derived layout, each rendering one collection record
// found by the plain text of one of its String fields. Two records sharing that value would be
// found by the same URL: a duplicate path (ADR 0009).

/** A record's String field as a path segment, or null when it can't be one. */
export function pageValue(content: Record<string, unknown> | null, field: string) {
  const value = content?.[field];
  if (typeof value !== "string" && (typeof value !== "object" || value === null)) return null;
  const text = lexicalStateToPlainText(value as string | Record<string, unknown>);
  // Empty values and values containing `/` can't be a path segment.
  return text && !text.includes("/") ? text : null;
}

/**
 * Records sharing the value their record pages are found by, one group per value. Records
 * whose value can't be a path segment have no page, so they share nothing.
 */
export function recordsSharingPageValues<T>(
  records: readonly T[],
  valueOf: (record: T) => string | null,
): T[][] {
  const byValue = new Map<string, T[]>();
  for (const record of records) {
    const value = valueOf(record);
    if (value === null) continue;
    byValue.set(value, [...(byValue.get(value) ?? []), record]);
  }
  return [...byValue.values()].filter((group) => group.length > 1);
}

/** The record pages a project's layouts declare. */
export const recordPageLayouts = Effect.fn("collections.recordPageLayouts")(function* (
  db: Database,
  where: { projectId: number; draft: DraftScope },
) {
  const scope = and(eq(layouts.projectId, where.projectId), definitionsIn(layouts, where.draft));
  const rows = yield* Effect.promise(() =>
    db
      .select({
        projectId: layouts.projectId,
        layoutId: layouts.layoutId,
        recordPages: layouts.recordPages,
      })
      .from(layouts)
      .where(and(scope, eq(layouts.kind, "derived"), isNotNull(layouts.recordPages))),
  );
  return rows.flatMap(({ recordPages, ...layout }) =>
    recordPages ? [{ ...layout, ...recordPages }] : [],
  );
});
