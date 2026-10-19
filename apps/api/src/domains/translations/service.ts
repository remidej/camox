import { and, eq, inArray, lte, sql } from "drizzle-orm";
import { Effect } from "effect";

import type { Database } from "../../db";
import {
  AiJobQueue,
  jobName,
  TRANSLATED_ENTITIES,
  type TranslatedEntity,
  type TranslationJob,
} from "../../lib/ai-job-queue";
import { Background } from "../../lib/background";
import { Journal, record } from "../../lib/journal";
import * as overlay from "../drafts/overlay";
import { drafts } from "../drafts/schema";
import { draftOf, type Draft } from "../drafts/scope";
import { locales } from "../locales/schema";
import { translationClaims, translationRequests } from "./schema";

// Camox keeps every locale translated from the default locale (ADR 0015). Every write to a
// default-locale entity in a draft, whatever wrote it, requests its translation into each of the
// draft's other locales, and adding a locale requests the whole website's. A request stays
// pending until a job of its key finishes; jobs run on the AI job scheduler, debounced like
// generated values (ADR 0012).

/** How long a translation waits for more edits before running, unless asked for immediately. */
const DEBOUNCE_MS = 5000;

/** An entity to translate: a localized entity, by kind and id. */
export type Translatable = { entity: TranslatedEntity; id: string };

const isTranslated = (entity: string): entity is TranslatedEntity =>
  (TRANSLATED_ENTITIES as readonly string[]).includes(entity);

/** Records that a draft's pending translations changed: its locales show whether they translate. */
const recordPending = (db: Database, draft: Draft) =>
  record(db, { kind: "translations", projectId: draft.projectId, draftId: draft.id });

// D1 binds at most 100 parameters per statement; a request row takes six.
const ROWS_PER_INSERT = 15;

/**
 * Requests translations of default-locale entities of a draft into locales: marks each pending
 * and schedules its job, after the debounce or `immediately`. A newer request of the same entity,
 * locale and draft replaces a pending job. Scheduling doesn't hold up the request: it runs after
 * it, and a job that can't be scheduled settles its request, leaving nothing pending.
 */
export const requestTranslations = Effect.fn("translations.request")(function* (
  db: Database,
  draft: Draft,
  entities: readonly Translatable[],
  targets: readonly string[],
  options: { immediately?: boolean } = {},
) {
  const jobs: TranslationJob[] = entities.flatMap(({ entity, id }) =>
    targets.map((locale) => ({
      kind: "translation" as const,
      entity,
      entityId: id,
      locale,
      draftId: draft.id,
    })),
  );
  if (jobs.length === 0) return;
  const requestedAt = Date.now();
  for (let start = 0; start < jobs.length; start += ROWS_PER_INSERT) {
    const rows = jobs.slice(start, start + ROWS_PER_INSERT).map((job) => ({
      projectId: draft.projectId,
      draftId: job.draftId,
      entity: job.entity,
      entityId: job.entityId,
      locale: job.locale,
      requestedAt,
    }));
    yield* Effect.promise(() =>
      db
        .insert(translationRequests)
        .values(rows)
        .onConflictDoUpdate({
          target: [
            translationRequests.draftId,
            translationRequests.entity,
            translationRequests.entityId,
            translationRequests.locale,
          ],
          set: { requestedAt: sql`excluded.requested_at` },
        }),
    );
  }
  yield* recordPending(db, draft);

  const queue = yield* AiJobQueue;
  const background = yield* Background;
  const delayMs = options.immediately ? 0 : DEBOUNCE_MS;
  yield* background.run(
    Effect.forEach(
      jobs,
      (job) =>
        queue
          .schedule(job, delayMs)
          .pipe(
            Effect.catchTag("ScheduleError", (error) =>
              Effect.logError(
                `[translation] ${jobName(job)} could not be scheduled`,
                error.cause,
              ).pipe(Effect.andThen(settleTranslation(db, job, requestedAt))),
            ),
          ),
      { concurrency: 10, discard: true },
    ),
  );
});

/** The pending request of a job, or undefined once there's nothing left to do for it. */
export const pendingRequest = (db: Database, job: TranslationJob) =>
  Effect.promise(() => db.select().from(translationRequests).where(keyOf(job)).get());

const keyOf = (job: TranslationJob) =>
  and(
    eq(translationRequests.draftId, job.draftId),
    eq(translationRequests.entity, job.entity),
    eq(translationRequests.entityId, job.entityId),
    eq(translationRequests.locale, job.locale),
  );

/** Settles a job's request unless another was requested after `startedAt`. */
export const settleTranslation = Effect.fn("translations.settle")(function* (
  db: Database,
  job: TranslationJob,
  startedAt: number,
) {
  const settled = yield* Effect.promise(() =>
    db
      .delete(translationRequests)
      .where(and(keyOf(job), lte(translationRequests.requestedAt, startedAt)))
      .returning({ projectId: translationRequests.projectId }),
  );
  for (const { projectId } of settled) {
    yield* record(db, { kind: "translations", projectId, draftId: job.draftId });
  }
});

/**
 * The tags of the locales each draft has pending translations into, sorted, by draft id. A
 * draft translating nothing is missing from the map.
 */
export const translatingLocales = Effect.fn("translations.translatingLocales")(function* (
  db: Database,
  draftIds: readonly string[],
) {
  const translating = new Map<string, string[]>();
  if (draftIds.length === 0) return translating;
  const rows = yield* Effect.promise(() =>
    db
      .selectDistinct({ draftId: translationRequests.draftId, locale: translationRequests.locale })
      .from(translationRequests)
      .where(inArray(translationRequests.draftId, [...draftIds]))
      .orderBy(translationRequests.locale),
  );
  for (const { draftId, locale } of rows) {
    translating.set(draftId, [...(translating.get(draftId) ?? []), locale]);
  }
  return translating;
});

/** The locales a draft reads, its default locale's tag apart from the others'. */
export const draftLocales = Effect.fn("translations.draftLocales")(function* (
  db: Database,
  draft: Draft,
) {
  const rows = yield* overlay.select(db, draft, locales, eq(locales.projectId, draft.projectId));
  return {
    defaultTag: rows.find((row) => row.isDefault)?.tag,
    others: rows.filter((row) => !row.isDefault).map((row) => row.tag),
  };
});

/**
 * Requests the translation of every default-locale entity a unit of work wrote in a draft into
 * the draft's other locales. Runs once the work succeeded, with its journal: the overlay records
 * every localized write, so no write path can miss it.
 */
export const translateWrites = Effect.fn("translations.translateWrites")(function* () {
  const journal = yield* Journal;
  const { db } = journal;
  if (!db) return;
  const byDraft = new Map<string, (Translatable & { locale: string })[]>();
  for (const change of journal.changes) {
    if (change.kind !== "localizedWrite" || !isTranslated(change.entity)) continue;
    const write = { entity: change.entity, id: change.id, locale: change.locale };
    byDraft.set(change.draftId, [...(byDraft.get(change.draftId) ?? []), write]);
  }
  for (const [draftId, writes] of byDraft) {
    const row = yield* Effect.promise(() =>
      db.select().from(drafts).where(eq(drafts.id, draftId)).get(),
    );
    if (!row) continue;
    const draft = draftOf(row);
    const { defaultTag, others } = yield* draftLocales(db, draft);
    if (others.length === 0) continue;
    const entities = new Map<string, Translatable>();
    for (const { entity, id, locale } of writes) {
      if (locale === defaultTag) entities.set(`${entity}:${id}`, { entity, id });
    }
    yield* requestTranslations(db, draft, [...entities.values()], others);
  }
});

/**
 * Requests the translation of every entity a draft reads in its default locale into a locale it
 * adds: the job fills the localization adding it copied.
 */
export const translateIntoLocale = Effect.fn("translations.translateIntoLocale")(function* (
  db: Database,
  draft: Draft,
  tag: string,
) {
  const source = draftOf(draft);
  const entities: Translatable[] = [];
  for (const entity of TRANSLATED_ENTITIES) {
    const table = overlay.contentTableOf(entity);
    const rows = yield* Effect.promise(
      () =>
        db
          .select({ id: table.id })
          .from(table)
          .where(
            and(
              overlay.visibleIn(table, source),
              overlay.registrationOf(table).inProject(draft.projectId),
            ),
          ) as Promise<{ id: string }[]>,
    );
    for (const { id } of rows) entities.push({ entity, id });
  }
  yield* requestTranslations(db, draft, entities, [tag], { immediately: true });
});

/** Statements dropping a draft's pending translations and claims in a locale it removes. */
export function dropLocaleStatements(db: Database, draft: Draft, tag: string) {
  return [
    db
      .delete(translationRequests)
      .where(and(eq(translationRequests.draftId, draft.id), eq(translationRequests.locale, tag))),
    db
      .delete(translationClaims)
      .where(and(eq(translationClaims.draftId, draft.id), eq(translationClaims.locale, tag))),
  ];
}

/**
 * Statements dropping a draft's pending translations and claims when it's published or
 * discarded: its jobs then do nothing, also in a development draft, which stays (ADR 0006).
 */
export function endStatements(db: Database, draftId: string) {
  return [
    db.delete(translationRequests).where(eq(translationRequests.draftId, draftId)),
    db.delete(translationClaims).where(eq(translationClaims.draftId, draftId)),
  ];
}
