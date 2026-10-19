import { and, eq, ne } from "drizzle-orm";
import { Effect } from "effect";

import type { Database } from "../../db";
import { jobName, type TranslationJob } from "../../lib/ai-job-queue";
import { AiModel, type TranslationText, type Translations } from "../../lib/ai-model";
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
import { inLocale, type Draft } from "../drafts/scope";
import { draftScopeOfJob } from "../drafts/service";
import { type GenerationTarget, requestGeneration } from "../generated-values/generation";
import { homeOf } from "../generated-values/service";
import { claimUnique, releaseClaims } from "./claims";
import { translateDefaults } from "./defaults";
import { draftLocales, pendingRequest, settleTranslation } from "./service";
import { contentTexts, slugOf } from "./texts";

// A translation job (ADR 0015): it writes an entity's localization in one locale of a draft from
// the entity as the draft reads it in the default locale, as ordinary content through the
// overlay. In this version a translation replaces the whole localization: text is translated,
// everything else copied as it is, ids included. A job whose request is gone does nothing.

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

const copyOf = (row: Row) =>
  Object.fromEntries(Object.entries(row).filter(([column]) => !IDENTITY.has(column)));

/** Where a job reads and writes: its draft in the default locale, and in the job's locale. */
type TranslationScope = { draft: Draft; target: Draft; from: string; to: string };

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
  const { defaultTag, others } = yield* draftLocales(db, draft);
  if (defaultTag === undefined || !others.includes(job.locale)) return;
  const scope: TranslationScope = {
    draft,
    target: inLocale(draft, job.locale),
    from: defaultTag,
    to: job.locale,
  };
  const table = overlay.contentTableOf(job.entity);
  const source = (yield* overlay.get(db, draft, table, job.entityId)) as Row | undefined;
  const current = yield* overlay.get(db, scope.target, table, job.entityId);

  // A source deleted from the default locale takes its localizations along.
  if (!source) {
    if (current) yield* overlay.remove(db, scope.target, table, job.entityId);
    yield* releaseClaims(db, draft, job.locale, job.entityId);
    return;
  }

  const localized = { ...copyOf(source), ...(yield* localize(db, scope, job.entity, source)) };
  const written = current
    ? yield* overlay.update(db, scope.target, table, job.entityId, localized)
    : yield* overlay.insert(db, scope.target, table, { ...localized, id: job.entityId });
  if (job.entity === "page" && written) {
    yield* movePageDescendants(db, scope, written as typeof pages.$inferSelect);
  }
  // The locale's page SEO is generated from what was just written (ADR 0012).
  if (written && isGeneratedEntity(job.entity)) {
    const row = written as Row & { projectId: number };
    yield* requestGeneration(db, homeOf(scope.target, row.projectId), {
      entity: job.entity,
      row,
    } as GenerationTarget);
  }
});

const isGeneratedEntity = (
  entity: TranslationJob["entity"],
): entity is "page" | "block" | "repeatableItem" =>
  entity === "page" || entity === "block" || entity === "repeatableItem";

/** The localized values of an entity: its source's text translated, by kind of entity. */
const localize = Effect.fn("translation.localize")(function* (
  db: Database,
  scope: TranslationScope,
  entity: TranslationJob["entity"],
  source: Row,
) {
  switch (entity) {
    case "page":
      return yield* localizePage(db, scope, source as typeof pages.$inferSelect);
    case "block":
    case "sharedContent": {
      const row = source as Row & { projectId: number; type: string; content: unknown };
      const schemas = yield* loadDefinitionSchemas(
        db,
        { projectId: row.projectId, type: row.type },
        scope.draft,
      );
      return { content: yield* translateContent(scope, schemas?.contentSchema, row.content) };
    }
    case "repeatableItem": {
      const item = source as typeof repeatableItems.$inferSelect;
      const schema = yield* itemContentSchema(db, scope.draft, item);
      return { content: yield* translateContent(scope, schema, item.content) };
    }
    case "record":
      return yield* localizeRecord(db, scope, source as typeof collectionRecords.$inferSelect);
  }
});

/** Asks the model for texts' translations, unless there are none to translate. */
const translateTexts = Effect.fn("translation.texts")(function* (
  scope: TranslationScope,
  texts: TranslationText[],
) {
  if (texts.length === 0) return {} as Translations;
  const model = yield* AiModel;
  return yield* model.translate({ from: scope.from, to: scope.to, texts });
});

const translateContent = Effect.fn("translation.content")(function* (
  scope: TranslationScope,
  schema: unknown,
  content: unknown,
) {
  if (content === null || typeof content !== "object" || Array.isArray(content)) return content;
  const { texts, translated } = contentTexts(schema, content as Record<string, unknown>);
  return translated(yield* translateTexts(scope, texts));
});

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
 * A page's translated path segment and SEO, and a full path under its parent's localization
 * that no other page of the locale has: a numbered segment where the translation is taken.
 */
const localizePage = Effect.fn("translation.page")(function* (
  db: Database,
  scope: TranslationScope,
  page: typeof pages.$inferSelect,
) {
  const texts: TranslationText[] = [];
  if (page.pathSegment !== "")
    texts.push({ key: "pathSegment", text: page.pathSegment, format: "slug" });
  for (const key of ["metaTitle", "metaDescription"] as const) {
    const text = page[key];
    if (text) texts.push({ key, text, format: "plain" });
  }
  const translations = yield* translateTexts(scope, texts);

  const parent =
    page.parentPageId === null
      ? undefined
      : ((yield* overlay.get(db, scope.target, pages, page.parentPageId)) ??
        (yield* overlay.get(db, scope.draft, pages, page.parentPageId)));
  const segment = page.pathSegment === "" ? "" : slugOf(translations.pathSegment, page.pathSegment);
  const placed = yield* placePage(db, scope, page, parent?.fullPath ?? "", segment);
  return {
    ...placed,
    metaTitle: page.metaTitle && (translations.metaTitle ?? page.metaTitle),
    metaDescription: page.metaDescription && (translations.metaDescription ?? page.metaDescription),
  };
});

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
 * A record's translated content. A value its record pages are found by, such as a slug, is
 * translated as a URL path segment, and gets a number where another record of the collection
 * has it in the locale, or another job claimed it.
 */
const localizeRecord = Effect.fn("translation.record")(function* (
  db: Database,
  scope: TranslationScope,
  record: typeof collectionRecords.$inferSelect,
) {
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
  const foundBy = new Set(
    (yield* recordPageLayouts(db, { projectId: record.projectId, draft: scope.draft }))
      .filter((layout) => layout.collectionId === record.collectionId)
      .map((layout) => layout.field),
  );
  const { texts, translated } = contentTexts(definition?.contentSchema, record.content, foundBy);
  const content = translated(yield* translateTexts(scope, texts));
  if (foundBy.size === 0) return { content };

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
  for (const field of foundBy) {
    const value = content[field];
    if (typeof value !== "string" || pageValue(content, field) === null) continue;
    const taken = new Set(others.flatMap((other) => pageValue(other.content, field) ?? []));
    const space = {
      draft: scope.draft,
      locale: scope.to,
      space: `record:${record.collectionId}:${field}`,
    };
    content[field] = yield* claimUnique(db, space, record.id, taken, (n) =>
      n === 1 ? value : `${value}-${n}`,
    );
  }
  return { content };
});
