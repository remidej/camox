import { and, eq, inArray, isNotNull, lte, ne, sql } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { Context, Effect } from "effect";

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
import { readInChunks } from "../content/chunks";
import * as overlay from "../drafts/overlay";
import { drafts } from "../drafts/schema";
import { draftOf, type Draft } from "../drafts/scope";
import { defaultLocaleTag } from "../locales/default-locale";
import { locales } from "../locales/schema";
import {
  translationBookkeeping,
  translationClaims,
  translationRequests,
  type TranslationRequestSource,
} from "./schema";

// Camox keeps every locale translated from the default locale (ADR 0015). Every write to a
// default-locale entity in a draft, whatever wrote it, requests its translation into each of the
// draft's other locales, and adding a locale requests the whole website's. A request stays
// pending until a job of its key finishes; jobs run on the AI job scheduler, debounced like
// generated values (ADR 0012).

/** How long a translation waits for more edits before running, unless asked for immediately. */
const DEBOUNCE_MS = 5000;

/** An entity to translate: a localized entity, by kind and id. */
export type Translatable = { entity: TranslatedEntity; id: string };

export const isTranslated = (entity: string): entity is TranslatedEntity =>
  (TRANSLATED_ENTITIES as readonly string[]).includes(entity);

/** Records that a draft's pending translations changed: its locales show whether they translate. */
const recordPending = (db: Database, draft: Draft) =>
  record(db, { kind: "translations", projectId: draft.projectId, draftId: draft.id });

// D1 binds at most 100 parameters per statement; a request row takes four, beside three shared.
const ROWS_PER_INSERT = 24;

/** What a job translates, as its request stores it: a job's translations settle apart. */
const sourceOf = (job: TranslationJob): TranslationRequestSource => job.source ?? "defaultLocale";

/**
 * What runs once a translation of a draft settles, whichever way it settles: Camox publishes its
 * catch-up draft once nothing is left to translate in it (`publishWhenTranslated`, ADR 0017).
 * Provided with the AI services, so translating needn't depend on publishing.
 */
export class TranslationSettled extends Context.Service<
  TranslationSettled,
  { readonly run: (db: Database, draftId: string) => Effect.Effect<void, never, Journal> }
>()("camox/TranslationSettled") {}

/** Whether a draft has pending translations, as a condition usable in any statement. */
export const hasPendingTranslations = (draftId: string) =>
  sql`exists (select 1 from ${translationRequests} where ${translationRequests.draftId} = ${draftId})`;

/**
 * A statement for a batch that aborts it while the draft has pending translations: a translation
 * requested since the draft was checked would be dropped with it.
 */
export const noPendingTranslationsGuard = (draftId: string) =>
  sql`select case when ${hasPendingTranslations(draftId)}
    then json('the draft has pending translations') else 1 end`;

/**
 * Requests translations of default-locale entities of a draft into locales: marks each pending
 * and schedules its job, after the debounce or `immediately`. A newer request of the same entity,
 * locale, draft and source replaces a pending job. Scheduling doesn't hold up the request: it runs
 * after it, and a job that can't be scheduled settles its request, leaving nothing pending.
 * Requests nothing once the draft has ended. Whether it requested anything.
 */
export const requestTranslations = Effect.fn("translations.request")(function* (
  db: Database,
  draft: Draft,
  entities: readonly Translatable[],
  targets: readonly string[],
  options: { immediately?: boolean; source?: TranslationJob["source"] } = {},
) {
  const jobs: TranslationJob[] = entities.flatMap(({ entity, id }) =>
    targets.map((locale) => ({
      kind: "translation" as const,
      entity,
      entityId: id,
      locale,
      draftId: draft.id,
      ...(options.source && { source: options.source }),
    })),
  );
  if (jobs.length === 0) return false;
  const requestedAt = Date.now();
  const source: TranslationRequestSource = options.source ?? "defaultLocale";
  for (let start = 0; start < jobs.length; start += ROWS_PER_INSERT) {
    const rows = jobs
      .slice(start, start + ROWS_PER_INSERT)
      .map((job) => sql`(${job.entity}, ${job.entityId}, ${job.locale}, ${source})`);
    // Only into a draft still open, in the same statement: a draft that ended since, such as a
    // catch-up draft Camox just published, would leave them pending forever.
    const inserted = yield* Effect.promise(() =>
      db.run(sql`
        insert into ${translationRequests}
          (project_id, draft_id, entity, entity_id, locale, source, requested_at)
        select ${draft.projectId}, ${draft.id}, "column1", "column2", "column3", "column4", ${requestedAt}
        from (values ${sql.join(rows, sql`, `)})
        where exists (select 1 from ${drafts} where ${drafts.id} = ${draft.id})
        on conflict (draft_id, entity, entity_id, locale, source)
        do update set requested_at = excluded.requested_at`),
    );
    if (inserted.meta.changes === 0) return false;
  }
  yield* recordPending(db, draft);

  const queue = yield* AiJobQueue;
  const background = yield* Background;
  const settled = yield* TranslationSettled;
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
              ).pipe(
                Effect.andThen(settleTranslation(db, job, requestedAt)),
                Effect.provideService(TranslationSettled, settled),
              ),
            ),
          ),
      { concurrency: 10, discard: true },
    ),
  );
  return true;
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
    eq(translationRequests.source, sourceOf(job)),
  );

/**
 * Settles a job's request unless another was requested after `startedAt`, then runs what follows
 * a settled translation (`TranslationSettled`). Every request settles here, whether its job ran,
 * failed or couldn't be scheduled.
 */
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
  yield* (yield* TranslationSettled).run(db, job.draftId);
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

/** A pending translation: what it translates, into which locale, from which source. */
export type PendingTranslation = Translatable & {
  locale: string;
  source: TranslationRequestSource;
};

/** A draft's pending translations, which publishing it drops. */
export const pendingRequestsOf = Effect.fn("translations.pendingRequestsOf")(function* (
  db: Database,
  draftId: string,
) {
  const rows: PendingTranslation[] = yield* Effect.promise(() =>
    db
      .select({
        entity: translationRequests.entity,
        id: translationRequests.entityId,
        locale: translationRequests.locale,
        source: translationRequests.source,
      })
      .from(translationRequests)
      .where(eq(translationRequests.draftId, draftId)),
  );
  return rows;
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
    // A release's writes are translated in Camox's catch-up draft (`catchUpReleaseWrites`).
    if (change.draftId === null) continue;
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

/**
 * Requests the translation of code-owned defaults into the locale a draft placed them in, unless
 * that's the default locale: nobody chose that content. They're a placed block's, or the shared
 * content a synced block created. Defaults placed in the default locale are translated like any
 * other write to it.
 */
export const translatePlacedDefaults = Effect.fn("translations.translatePlacedDefaults")(function* (
  db: Database,
  scope: Draft,
  placed: Translatable & { entity: "block" | "sharedContent" },
) {
  if (scope.locale === undefined) return;
  const { defaultTag, others } = yield* draftLocales(db, scope);
  if (scope.locale === defaultTag || !others.includes(scope.locale)) return;
  yield* requestTranslations(db, draftOf(scope), [placed], [scope.locale], {
    immediately: true,
    source: "defaults",
  });
});

/**
 * Requests merges of the localizations a publish just changed on Live, `published`'s changes,
 * into the other open drafts that copied them before: each draft's copy now conflicts with
 * Live's, and a `live` translation job merges the two before the draft publishes (ADR 0016).
 * Only localizations in a locale other than the default one: conflicts in the default locale are
 * confirmed as they were (ADR 0009).
 */
export const requestLiveMerges = Effect.fn("translations.requestLiveMerges")(function* (
  db: Database,
  published: Draft,
  changes: readonly overlay.StoredChange[],
) {
  const defaultTag = yield* defaultLocaleTag(db, published.projectId);
  const changed = changes.flatMap(({ entity, row }) => {
    const locale = overlay.localeOfRow(row);
    if (!isTranslated(entity) || row.deleted || locale === null) return [];
    return locale === defaultTag ? [] : [{ entity, id: row.id, locale }];
  });
  const byDraft = new Map<string, Map<string, Translatable[]>>();
  for (const entity of TRANSLATED_ENTITIES) {
    const keys = changed.filter((localization) => localization.entity === entity);
    const table = overlay.contentTableOf(entity);
    const copies = yield* readInChunks(
      keys,
      (chunk) =>
        Effect.promise(() =>
          db
            .select({
              draftId: sql<string>`${table.draftId}`,
              id: sql<string>`${table.id}`,
              locale: sql<string>`"locale"`,
            })
            .from(table as SQLiteTable)
            .where(
              and(
                ne(table.draftId, published.id),
                isNotNull(table.baseVersion),
                eq(table.deleted, false),
                sql`(${table.id}, "locale") in (${sql.join(
                  chunk.map(({ id, locale }) => sql`(${id}, ${locale})`),
                  sql`, `,
                )})`,
              ),
            ),
        ),
      KEYS_PER_SELECT,
    );
    for (const { draftId, id, locale } of copies) {
      const byLocale = byDraft.get(draftId) ?? new Map<string, Translatable[]>();
      byLocale.set(locale, [...(byLocale.get(locale) ?? []), { entity, id }]);
      byDraft.set(draftId, byLocale);
    }
  }
  if (byDraft.size === 0) return;
  const rows = yield* Effect.promise(() =>
    db
      .select()
      .from(drafts)
      .where(inArray(drafts.id, [...byDraft.keys()])),
  );
  for (const row of rows) {
    const draft = draftOf(row);
    for (const [locale, entities] of byDraft.get(row.id)!) {
      yield* requestTranslations(db, draft, entities, [locale], {
        immediately: true,
        source: "live",
      });
    }
  }
});

// D1 binds at most 100 parameters per statement; a key takes two.
const KEYS_PER_SELECT = 45;

/**
 * Statements dropping a draft's pending translations, claims and bookkeeping in a locale it
 * removes.
 */
export function dropLocaleStatements(db: Database, draft: Draft, tag: string) {
  return [
    db
      .delete(translationRequests)
      .where(and(eq(translationRequests.draftId, draft.id), eq(translationRequests.locale, tag))),
    db
      .delete(translationClaims)
      .where(and(eq(translationClaims.draftId, draft.id), eq(translationClaims.locale, tag))),
    db
      .delete(translationBookkeeping)
      .where(
        and(eq(translationBookkeeping.draftId, draft.id), eq(translationBookkeeping.locale, tag)),
      ),
  ];
}

/**
 * Statements dropping a draft's pending translations, claims and bookkeeping when it's published
 * or deleted: its jobs then do nothing, also in a development draft, which stays (ADR 0006).
 * Publishing copies its bookkeeping to Live first (`bookkeeping.publishStatements`).
 */
export function endStatements(db: Database, draftId: string) {
  return [
    db.delete(translationRequests).where(eq(translationRequests.draftId, draftId)),
    db.delete(translationClaims).where(eq(translationClaims.draftId, draftId)),
    db.delete(translationBookkeeping).where(eq(translationBookkeeping.draftId, draftId)),
  ];
}
