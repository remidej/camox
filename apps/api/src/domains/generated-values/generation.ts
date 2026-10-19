import { Effect } from "effect";

import type { Database } from "../../db";
import type { AiModel } from "../../lib/ai-model";
import { Background } from "../../lib/background";
import {
  type GenerationJob,
  GenerationScheduler,
  type JobEntity,
  jobName,
} from "../../lib/generation-scheduler";
import { isRasterImage } from "../../lib/image-transform";
import type { Journal } from "../../lib/journal";
import type { AiCallError } from "../../lib/retry-ai-call";
import { blocks, pages, repeatableItems } from "../../schema";
import { executeBlockSummary } from "../blocks/service";
import * as overlay from "../drafts/overlay";
import { inDefaultLocale, inLocale, type ReadScope } from "../drafts/scope";
import { draftScopeOfJob } from "../drafts/service";
import { metadataGenerated } from "../files/generated-metadata";
import type { files } from "../files/schema";
import { executeFileMetadata } from "../files/service";
import { executePageSeo } from "../pages/ai";
import { seoGenerated } from "../pages/generated-seo";
import { executeRepeatableItemSummary } from "../repeatable-items/service";
import type { GeneratedType } from "./schema";
import {
  defaultLocaleTag,
  homeOf,
  markRequested,
  settleFailedRequest,
  settleRequest,
  type ValueHome,
  type ValueKey,
} from "./service";

// Generation of the values that sit beside content (ADR 0012). Callers say which entity changed,
// in which scope; this module knows, per kind of job, the value it generates, how long to wait
// for more edits, whether a manual group skips it, and which parent's value it makes stale: an
// item's summary feeds its block's, which feeds its page's SEO.
//
// SEO and alt text are generated in each locale; summaries in the default locale only (ADR
// 0015). An edit in another locale generates no summary: it makes its page's SEO in that locale
// stale directly.

/** What a request needs of each entity: its id, and what tells whether its group is generated. */
type JobRows = {
  block: { id: string };
  repeatableItem: { id: string };
  page: Pick<typeof pages.$inferSelect, "id" | "metaTitle" | "metaDescription">;
  file: Pick<typeof files.$inferSelect, "id" | "alt" | "filename" | "mimeType" | "localizedAlts">;
};

/** An entity whose value to generate. */
export type GenerationTarget = { [E in JobEntity]: { entity: E; row: JobRows[E] } }[JobEntity];

/** The parent a generated value made stale, in the same scope, to generate again. */
export type Stale = { projectId: number; target: GenerationTarget };

type Kind<E extends JobEntity> = {
  type: GeneratedType;
  /** Whether the value is generated in each locale, rather than in the default locale only. */
  localized: boolean;
  /** How long to wait for more edits before generating, unless asked for immediately. */
  debounceMs: number;
  /**
   * Whether the entity's group is generated in a locale, named by its tag or without one the
   * default locale: a manual one generates nothing.
   */
  generated: (row: JobRows[E], locale: string | undefined) => boolean;
  /**
   * Generates the value as the scope reads it and settles the request, unless another came after
   * `startedAt`. Returns the parent the new value made stale.
   */
  generate: (
    db: Database,
    scope: ReadScope,
    entityId: string,
    startedAt: number,
  ) => Effect.Effect<Stale | null, AiCallError, AiModel | Journal>;
};

// `generate` reaches the domains lazily: they request generation from this module too.
const KINDS: { [E in JobEntity]: Kind<E> } = {
  repeatableItem: {
    type: "summary",
    localized: false,
    debounceMs: 5000,
    generated: () => true,
    generate: (db, scope, ...rest) =>
      executeRepeatableItemSummary(db, inDefaultLocale(scope), ...rest),
  },
  block: {
    type: "summary",
    localized: false,
    debounceMs: 5000,
    generated: () => true,
    generate: (db, scope, ...rest) => executeBlockSummary(db, inDefaultLocale(scope), ...rest),
  },
  page: {
    type: "seo",
    localized: true,
    // Long enough for the edits of a page's blocks to land first.
    debounceMs: 15000,
    generated: (page) => seoGenerated(page),
    generate: (...args) => executePageSeo(...args),
  },
  file: {
    type: "fileMetadata",
    localized: true,
    debounceMs: 0,
    generated: (file, locale) => metadataGenerated(file, locale) && isRasterImage(file.mimeType),
    generate: (...args) => executeFileMetadata(...args),
  },
};

const kindOf = (entity: JobEntity) => KINDS[entity] as unknown as Kind<JobEntity>;

const keyOf = (entity: JobEntity, entityId: string): ValueKey => ({
  entity,
  entityId,
  type: kindOf(entity).type,
});

/** The page holding a block or an item's block in a scope's locale, if any. */
const pageOf = Effect.fn("generation.pageOf")(function* (
  db: Database,
  scope: ReadScope,
  entity: "block" | "repeatableItem",
  id: string,
) {
  let blockId: string | null = id;
  if (entity === "repeatableItem") {
    blockId = (yield* overlay.get(db, scope, repeatableItems, id))?.blockId ?? null;
  }
  const block = blockId === null ? undefined : yield* overlay.get(db, scope, blocks, blockId);
  if (!block?.pageId) return undefined;
  return yield* overlay.get(db, scope, pages, block.pageId);
});

/**
 * Requests an entity's value in a scope, unless its group is manual: marks it pending and
 * schedules its job, after the kind's debounce or `immediately`. A newer request for the same
 * entity, scope and locale replaces a pending job. Scheduling doesn't hold up the request: it
 * runs after it, and a job that can't be scheduled settles its request, leaving nothing pending.
 * A summary requested in a locale other than the default one requests its page's SEO in that
 * locale instead.
 */
export const requestGeneration = Effect.fn("generation.request")(function* (
  db: Database,
  requested: ValueHome,
  target: GenerationTarget,
  options: { immediately?: boolean } = {},
): Effect.fn.Return<void, never, GenerationScheduler | Background | Journal> {
  const kind = kindOf(target.entity);
  // The default locale is requested without a tag, so its jobs have one key.
  const home =
    requested.locale !== undefined &&
    requested.locale === (yield* defaultLocaleTag(db, requested.projectId))
      ? { projectId: requested.projectId, draftId: requested.draftId }
      : requested;
  if (home.locale !== undefined && !kind.localized) {
    const scope = yield* draftScopeOfJob(db, home.draftId);
    if (scope === undefined) return;
    const page = yield* pageOf(
      db,
      inLocale(scope, home.locale),
      target.entity as "block" | "repeatableItem",
      target.row.id,
    );
    if (page) yield* requestGeneration(db, home, { entity: "page", row: page });
    return;
  }
  if (!kind.generated(target.row, home.locale)) return;
  const requestedAt = Date.now();
  const key = keyOf(target.entity, target.row.id);
  yield* markRequested(db, home, key, requestedAt);

  const job: GenerationJob = {
    entity: target.entity,
    entityId: target.row.id,
    draftId: home.draftId,
    ...(home.locale !== undefined ? { locale: home.locale } : {}),
  };
  const scheduler = yield* GenerationScheduler;
  const background = yield* Background;
  yield* background.run(
    scheduler
      .schedule(job, options.immediately ? 0 : kind.debounceMs)
      .pipe(
        Effect.catchTag("ScheduleError", (error) =>
          Effect.logError(`[generation] ${jobName(job)} could not be scheduled`, error.cause).pipe(
            Effect.andThen(settleRequest(db, home, key, requestedAt)),
          ),
        ),
      ),
  );
});

/**
 * Generates an entity's value now, as the scope reads it, then requests the parent it made
 * stale. A summary is generated from the default locale's content, whatever the scope's locale.
 */
export const generateNow = Effect.fn("generation.generateNow")(function* (
  db: Database,
  readScope: ReadScope,
  entity: JobEntity,
  entityId: string,
  startedAt: number = Date.now(),
) {
  const scope = kindOf(entity).localized ? readScope : inDefaultLocale(readScope);
  const stale = yield* kindOf(entity).generate(db, scope, entityId, startedAt);
  if (stale) yield* requestGeneration(db, homeOf(scope, stale.projectId), stale.target);
});

/**
 * Runs a scheduled job in the scope and locale it was scheduled from, or nothing once its draft
 * ended. A job that fails for good settles its request, so its value stops showing as pending,
 * and doesn't fail: the model already retried it.
 */
export const runGenerationJob = Effect.fn("generation.run")(function* (
  db: Database,
  job: GenerationJob,
) {
  const drafted = yield* draftScopeOfJob(db, job.draftId);
  if (drafted === undefined) return;
  const scope = job.locale === undefined ? drafted : inLocale(drafted, job.locale);
  const startedAt = Date.now();
  yield* generateNow(db, scope, job.entity, job.entityId, startedAt).pipe(
    Effect.catchCause((cause) =>
      Effect.logError(`[generation] ${jobName(job)} failed`, cause).pipe(
        Effect.andThen(
          settleFailedRequest(
            db,
            job.draftId,
            job.locale,
            keyOf(job.entity, job.entityId),
            startedAt,
          ),
        ),
      ),
    ),
  );
});
