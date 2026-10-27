import type { ReportEntity } from "@camox/api-contract/patrol";
import { and, eq, inArray, isNotNull, isNull, or } from "drizzle-orm";
import { Effect } from "effect";

import type { Database } from "../../db";
import { generatedValues, type GeneratedType } from "../generated-values/schema";
import { translationRequests } from "../translations/schema";
import { subjectKey } from "./reports";

// What each patroller is working on, read from its own pending records rather than from a shared
// table (ADR 0024): pending work settles with the job that does it, so a job that crashes can't
// leave a patroller working.

/** One subject a patroller is on, in a locale, pending since `requestedAt`. */
export type PendingWork = { entity: ReportEntity; id: string; locale: string; requestedAt: number };

/** The scopes a patroller's work is read in: drafts by id, Live as null. */
export type WorkScopes = readonly (string | null)[];

/** A patroller's pending work in some scopes of a project. */
export type PendingWorkOf = (
  db: Database,
  projectId: number,
  scopes: WorkScopes,
) => Effect.Effect<PendingWork[]>;

/** Each subject and locale once, pending since it was first requested. */
const firstRequestedPerSubject = (work: readonly PendingWork[]) => {
  const byKey = new Map<string, PendingWork>();
  for (const item of work) {
    const key = subjectKey(item.entity, item.id, item.locale);
    const known = byKey.get(key);
    if (!known || item.requestedAt < known.requestedAt) byKey.set(key, item);
  }
  return [...byKey.values()];
};

/** The Translator's pending translation requests: translations only run in drafts. */
export const pendingTranslations: PendingWorkOf = (db, projectId, scopes) => {
  const drafts = scopes.filter((scope) => scope !== null);
  if (drafts.length === 0) return Effect.succeed([]);
  return Effect.map(
    Effect.promise(() =>
      db
        .select({
          entity: translationRequests.entity,
          id: translationRequests.entityId,
          locale: translationRequests.locale,
          requestedAt: translationRequests.requestedAt,
        })
        .from(translationRequests)
        .where(
          and(
            eq(translationRequests.projectId, projectId),
            inArray(translationRequests.draftId, drafts),
          ),
        ),
    ),
    firstRequestedPerSubject,
  );
};

/** The SEO manager's pending generated values of `types`. */
export const pendingGeneratedValues =
  (types: readonly GeneratedType[]): PendingWorkOf =>
  (db, projectId, scopes) => {
    const drafts = scopes.filter((scope) => scope !== null);
    if (scopes.length === 0) return Effect.succeed([]);
    return Effect.map(
      Effect.promise(() =>
        db
          .select({
            entity: generatedValues.entity,
            id: generatedValues.entityId,
            locale: generatedValues.locale,
            requestedAt: generatedValues.requestedAt,
          })
          .from(generatedValues)
          .where(
            and(
              eq(generatedValues.projectId, projectId),
              inArray(generatedValues.type, [...types]),
              isNotNull(generatedValues.requestedAt),
              or(
                ...(scopes.includes(null) ? [isNull(generatedValues.draftId)] : []),
                ...(drafts.length > 0 ? [inArray(generatedValues.draftId, drafts)] : []),
              ),
            ),
          ),
      ),
      (rows) =>
        firstRequestedPerSubject(rows.map((row) => ({ ...row, requestedAt: row.requestedAt! }))),
    );
  };
