import { and, eq, ne } from "drizzle-orm";
import { Effect } from "effect";

import type { Database } from "../../db";
import { jobName, type TranslationJob } from "../../lib/ai-job-queue";
import { AiModel, type MergeText, type TranslationText } from "../../lib/ai-model";
import type { AiCallError } from "../../lib/retry-ai-call";
import {
  blocks,
  collectionDefinitions,
  collectionRecords,
  pages,
  repeatableItems,
} from "../../schema";
import { definitionsIn } from "../_shared/definitions";
import { itemSchemas } from "../_shared/fields";
import { loadDefinitionSchemas } from "../blocks/content-schema";
import { pageValue, recordPageLayouts } from "../collections/record-pages";
import * as overlay from "../drafts/overlay";
import type { Draft } from "../drafts/scope";
import { draftScopeOfJob } from "../drafts/service";
import { type GenerationTarget, requestGeneration } from "../generated-values/generation";
import { homeOf } from "../generated-values/service";
import { readBookkeeping, type Values, writeBookkeeping } from "./bookkeeping";
import { claimUnique, releaseClaims } from "./claims";
import { translateDefaults } from "./defaults";
import { isLeftOut } from "./exclusions";
import { type Merged, mergeLocalization, type MergeModel, sameValue } from "./merge";
import { isOrderedEntity, placeLocalizedSibling, SIBLING_ORDER_COLUMNS } from "./order";
import { translationScope, type TranslationScope } from "./scope";
import { pendingRequest, settleTranslation } from "./service";
import { dropDescendants } from "./subtree";
import type { Shape } from "./texts";

// A translation job (ADR 0015): it brings an entity's localization in one locale of a draft up
// to date with the entity as the draft reads it in the default locale, as ordinary content
// through the overlay. It merges three ways, field by field, from the localization's bookkeeping
// (`merge.ts`), so hand edits survive while the rest follows the source, and records what it
// translated from and wrote in the bookkeeping. A job whose request is gone does nothing.

type Row = Record<string, unknown> & { id: string };

/** The overlay's own columns, which a localization never copies from its source. */
const IDENTITY = new Set([
  "rowId",
  "id",
  "locale",
  "draftId",
  "version",
  "baseVersion",
  "deleted",
  "firstPublishedAt",
  "publishedAt",
  "publishedBy",
]);

/** Timestamps, which a localization takes from its source and never merges. */
const TIMESTAMPS = new Set(["createdAt", "updatedAt", "contentUpdatedAt"]);

const copyOf = (row: Row) =>
  Object.fromEntries(Object.entries(row).filter(([column]) => !IDENTITY.has(column)));

/** What a localization merges: its columns but the overlay's own and its timestamps. */
const valuesOf = (row: Row): Values =>
  Object.fromEntries(
    Object.entries(row).filter(([column]) => !IDENTITY.has(column) && !TIMESTAMPS.has(column)),
  );

/**
 * Runs a translation job, unless its request is gone because its draft ended, was emptied or
 * dropped the locale since. A job that fails for good leaves the localization as it was and
 * settles its request, so its locale stops showing as translating.
 */
export const runTranslationJob = Effect.fn("translation.run")(function* (
  db: Database,
  job: TranslationJob,
) {
  if (!(yield* pendingRequest(db, job))) return;
  const draft = yield* draftScopeOfJob(db, job.draftId);
  const startedAt = Date.now();
  if (draft) {
    const run = job.source === "defaults" ? translateDefaults : translate;
    yield* run(db, draft, job).pipe(
      Effect.catchCause((cause) => Effect.logError(`[translation] ${jobName(job)} failed`, cause)),
    );
  }
  yield* settleTranslation(db, job, startedAt);
});

const translate = Effect.fn("translation.translate")(function* (
  db: Database,
  draft: Draft,
  job: TranslationJob,
) {
  const scope = yield* translationScope(db, draft, job.locale);
  if (!scope) return;
  const table = overlay.contentTableOf(job.entity);
  const source = (yield* overlay.get(db, draft, table, job.entityId)) as Row | undefined;
  const current = (yield* overlay.get(db, scope.target, table, job.entityId)) as Row | undefined;

  // A source deleted from the default locale takes its localizations along, with what's
  // beneath them in their locale.
  if (!source) {
    if (current) yield* overlay.remove(db, scope.target, table, job.entityId);
    yield* dropDescendants(db, scope.target, { entity: job.entity, id: job.entityId });
    yield* releaseClaims(db, draft, job.locale, job.entityId);
    return;
  }
  // A localization deleted from the locale stays deleted, and so does what's beneath it.
  if (yield* isLeftOut(db, draft, scope.target, job.entity, source)) return;

  const bookkeeping = current
    ? yield* readBookkeeping(db, scope.target, job.entity, job.entityId)
    : undefined;
  const shape = yield* shapeOf(db, scope, job.entity, source);
  const merged = yield* mergeLocalization(
    shape,
    modelFor(scope),
    valuesOf(source),
    current && valuesOf(current),
    bookkeeping,
  );
  // The locale may have left it out while the model ran.
  if (yield* isLeftOut(db, draft, scope.target, job.entity, source)) return;
  if (job.entity === "page") yield* placeLocalizedPage(db, scope, job.entityId, merged);
  if (isOrderedEntity(job.entity)) {
    const localizing = { entity: job.entity, source, current, bookkeeping };
    yield* placeLocalizedSibling(db, scope, localizing, merged);
  }
  if (job.entity === "record") {
    const record = source as typeof collectionRecords.$inferSelect;
    yield* keepFoundByUnique(db, scope, record, shape.slugs ?? new Set(), merged);
  }

  // A localization the merge leaves as it is isn't written: only its bookkeeping changes,
  // which sits beside content and is never a change to it (ADR 0012).
  const localized = { ...copyOf(source), ...merged.values };
  let written: Row | undefined;
  if (!current) {
    written = (yield* overlay.insert(db, scope.target, table, {
      ...localized,
      id: job.entityId,
    })) as Row | undefined;
  } else if (!sameValue(valuesOf(current), merged.values)) {
    written = (yield* overlay.update(db, scope.target, table, job.entityId, localized)) as
      | Row
      | undefined;
  }
  yield* writeBookkeeping(db, scope.target, job.entity, job.entityId, {
    source: valuesOf(source),
    output: merged.output,
  });
  if (job.entity === "page" && written) {
    yield* movePageDescendants(db, scope, written as typeof pages.$inferSelect);
  }
  // The locale's page SEO is generated from what was just written (ADR 0012).
  if (written && isGeneratedEntity(job.entity)) {
    yield* requestGeneration(db, homeOf(scope.target, draft.projectId), {
      entity: job.entity,
      row: written,
    } as GenerationTarget);
  }
});

const isGeneratedEntity = (
  entity: TranslationJob["entity"],
): entity is "page" | "block" | "repeatableItem" =>
  entity === "page" || entity === "block" || entity === "repeatableItem";

/** What the model is asked for a job: translations and merges from the default locale. */
const modelFor = (scope: TranslationScope): MergeModel<AiCallError, AiModel> => ({
  translate: (texts: TranslationText[]) =>
    AiModel.use((model) => model.translate({ from: scope.from, to: scope.to, texts })),
  merge: (texts: MergeText[]) =>
    AiModel.use((model) => model.merge({ from: scope.from, to: scope.to, texts })),
});

/** What an entity's localization holds, by kind of entity, read from its stored schemas. */
const shapeOf = Effect.fn("translation.shape")(function* (
  db: Database,
  scope: TranslationScope,
  entity: TranslationJob["entity"],
  source: Row,
) {
  switch (entity) {
    case "page":
      return {
        contentSchema: undefined,
        textColumns: { pathSegment: "slug", metaTitle: "plain", metaDescription: "plain" },
        // Page SEO is all generated or all manual (ADR 0012), so it's merged as one unit.
        columnGroups: [["metaTitle", "metaDescription"]],
        derived: new Set(["fullPath"]),
      } satisfies Shape;
    case "block":
    case "sharedContent": {
      const row = source as Row & { projectId: number; type: string };
      const schemas = yield* loadDefinitionSchemas(
        db,
        { projectId: row.projectId, type: row.type },
        scope.draft,
      );
      return {
        contentSchema: schemas?.contentSchema,
        // A block's order merges among its siblings (`order.ts`).
        derived: entity === "block" ? SIBLING_ORDER_COLUMNS : undefined,
      } satisfies Shape;
    }
    case "repeatableItem": {
      const item = source as typeof repeatableItems.$inferSelect;
      return {
        contentSchema: yield* itemContentSchema(db, scope.draft, item),
        derived: SIBLING_ORDER_COLUMNS,
      } satisfies Shape;
    }
    case "record": {
      const record = source as typeof collectionRecords.$inferSelect;
      const definition = yield* Effect.promise(() =>
        db
          .select({ contentSchema: collectionDefinitions.contentSchema })
          .from(collectionDefinitions)
          .where(
            and(
              eq(collectionDefinitions.projectId, record.projectId),
              eq(collectionDefinitions.collectionId, record.collectionId),
              definitionsIn(collectionDefinitions, scope.draft),
            ),
          )
          .get(),
      );
      return {
        contentSchema: definition?.contentSchema,
        slugs: yield* foundByOf(db, scope, record),
      } satisfies Shape;
    }
  }
});

/**
 * Sets a value that the job derives, such as a numbered path, in the merged values, and in what
 * Camox wrote where the merge wrote the value itself. A value kept from a hand edit stays the
 * hand edit's in the bookkeeping.
 */
function derive(merged: Merged, get: (values: Values) => unknown, set: (values: Values) => void) {
  if (sameValue(get(merged.output), get(merged.values))) set(merged.output);
  set(merged.values);
}

/** The content schema of an item, from its repeater in its root's definition. */
const itemContentSchema = Effect.fn("translation.itemContentSchema")(function* (
  db: Database,
  draft: Draft,
  item: typeof repeatableItems.$inferSelect,
) {
  // The item and its ancestors, up to its root.
  const chain = [item];
  for (let parentId = item.parentItemId; parentId !== null;) {
    const parent = yield* overlay.get(db, draft, repeatableItems, parentId);
    if (!parent || chain.some((known) => known.id === parent.id)) return undefined;
    chain.push(parent);
    parentId = parent.parentItemId;
  }
  let key: { projectId: number; type: string } | undefined;
  if (item.sharedContentType !== null && item.projectId !== null) {
    key = { projectId: item.projectId, type: item.sharedContentType };
  } else if (item.blockId !== null) {
    const block = yield* overlay.get(db, draft, blocks, item.blockId);
    key = block && { projectId: block.projectId, type: block.type };
  }
  if (!key) return undefined;
  const schemas = yield* loadDefinitionSchemas(db, key, draft);
  return itemSchemas(schemas?.contentSchema, chain).get(item.id)?.content;
});

const joinPath = (parentPath: string, segment: string) =>
  `${parentPath.replace(/\/$/, "")}/${segment}`;

/**
 * A page localization's path segment and full path under `parentPath`: `segment`, or a numbered
 * segment where another page of the locale has, or another job claimed, the full path.
 */
const placePage = Effect.fn("translation.placePage")(function* (
  db: Database,
  scope: TranslationScope,
  page: Pick<typeof pages.$inferSelect, "id" | "projectId">,
  parentPath: string,
  segment: string,
) {
  const taken = new Set(
    (yield* overlay.select(
      db,
      scope.target,
      pages,
      and(eq(pages.projectId, page.projectId), ne(pages.id, page.id)),
    )).map((other) => other.fullPath),
  );
  const segmentAt = (n: number) => (n === 1 ? segment : `${segment}-${n}`);
  const fullPath = yield* claimUnique(db, pathSpace(scope), page.id, taken, (n) =>
    joinPath(parentPath, segmentAt(n)),
  );
  return { pathSegment: fullPath.slice(fullPath.lastIndexOf("/") + 1), fullPath };
});

const pathSpace = (scope: TranslationScope) => ({
  draft: scope.draft,
  locale: scope.to,
  space: "page",
});

/**
 * Rewrites the full paths of a page localization's descendants under its new path, each unique
 * within the locale like the page's own.
 */
const movePageDescendants = Effect.fn("translation.movePageDescendants")(function* (
  db: Database,
  scope: TranslationScope,
  page: typeof pages.$inferSelect,
) {
  const all = yield* overlay.select(db, scope.target, pages, eq(pages.projectId, page.projectId));
  const seen = new Set([page.id]);
  const queue = [{ id: page.id, fullPath: page.fullPath }];
  for (let parent = queue.shift(); parent; parent = queue.shift()) {
    for (const child of all.filter((other) => other.parentPageId === parent!.id)) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      let placed = { pathSegment: child.pathSegment, fullPath: child.fullPath };
      if (joinPath(parent.fullPath, child.pathSegment) !== child.fullPath) {
        placed = yield* placePage(db, scope, child, parent.fullPath, child.pathSegment);
        yield* overlay.update(db, scope.target, pages, child.id, {
          ...placed,
          updatedAt: Date.now(),
        });
      }
      queue.push({ id: child.id, fullPath: placed.fullPath });
    }
  }
});

/**
 * Gives a merged page localization a full path under its parent's localization that no other
 * page of the locale has: a numbered segment where its merged segment is taken.
 */
const placeLocalizedPage = Effect.fn("translation.placeLocalizedPage")(function* (
  db: Database,
  scope: TranslationScope,
  id: string,
  merged: Merged,
) {
  const { parentPageId, projectId } = merged.values as {
    parentPageId: string | null;
    projectId: number;
  };
  const parent =
    parentPageId === null
      ? undefined
      : ((yield* overlay.get(db, scope.target, pages, parentPageId)) ??
        (yield* overlay.get(db, scope.draft, pages, parentPageId)));
  const segment = typeof merged.values.pathSegment === "string" ? merged.values.pathSegment : "";
  const placed = yield* placePage(db, scope, { id, projectId }, parent?.fullPath ?? "", segment);
  derive(
    merged,
    (values) => values.pathSegment,
    (values) => Object.assign(values, placed),
  );
});

/** The content fields a record's pages are found by, such as its slug. */
const foundByOf = Effect.fn("translation.foundBy")(function* (
  db: Database,
  scope: TranslationScope,
  record: typeof collectionRecords.$inferSelect,
) {
  return new Set(
    (yield* recordPageLayouts(db, { projectId: record.projectId, draft: scope.draft }))
      .filter((layout) => layout.collectionId === record.collectionId)
      .map((layout) => layout.field),
  );
});

/**
 * Keeps the values a merged record localization's pages are found by (`foundBy`), such as a
 * slug, unique within the locale: a number is added where another record of the collection has
 * it in the locale, or another job claimed it.
 */
const keepFoundByUnique = Effect.fn("translation.keepFoundByUnique")(function* (
  db: Database,
  scope: TranslationScope,
  record: typeof collectionRecords.$inferSelect,
  foundBy: ReadonlySet<string>,
  merged: Merged,
) {
  if (foundBy.size === 0) return;
  const others = yield* overlay.select(
    db,
    scope.target,
    collectionRecords,
    and(
      eq(collectionRecords.projectId, record.projectId),
      eq(collectionRecords.collectionId, record.collectionId),
      ne(collectionRecords.id, record.id),
    ),
  );
  const content = merged.values.content as Record<string, unknown>;
  for (const field of foundBy) {
    const value = content[field];
    if (typeof value !== "string" || pageValue(content, field) === null) continue;
    const taken = new Set(others.flatMap((other) => pageValue(other.content, field) ?? []));
    const space = {
      draft: scope.draft,
      locale: scope.to,
      space: `record:${record.collectionId}:${field}`,
    };
    const unique = yield* claimUnique(db, space, record.id, taken, (n) =>
      n === 1 ? value : `${value}-${n}`,
    );
    derive(
      merged,
      (values) => (values.content as Record<string, unknown> | undefined)?.[field],
      (values) => {
        values.content = { ...(values.content as Record<string, unknown>), [field]: unique };
      },
    );
  }
});
