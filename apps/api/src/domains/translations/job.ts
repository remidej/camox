import { and, eq, ne } from "drizzle-orm";
import { Effect } from "effect";

import type { Database } from "../../db";
import { AiModel, type TranslationText, type Translations } from "../../lib/ai-model";
import { jobName, type TranslationJob } from "../../lib/generation-scheduler";
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
type Places = { draft: Draft; target: Draft; from: string; to: string };

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
    yield* translate(db, draft, job).pipe(
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
  const places: Places = {
    draft,
    target: inLocale(draft, job.locale),
    from: defaultTag,
    to: job.locale,
  };
  const table = overlay.contentTableOf(job.entity);
  const source = (yield* overlay.get(db, draft, table, job.entityId)) as Row | undefined;
  const current = yield* overlay.get(db, places.target, table, job.entityId);

  // A source deleted from the default locale takes its localizations along.
  if (!source) {
    if (current) yield* overlay.remove(db, places.target, table, job.entityId);
    return;
  }

  const localized = { ...copyOf(source), ...(yield* localize(db, places, job.entity, source)) };
  const written = current
    ? yield* overlay.update(db, places.target, table, job.entityId, localized)
    : yield* overlay.insert(db, places.target, table, { ...localized, id: job.entityId });
  if (job.entity === "page" && written) {
    yield* movePageDescendants(db, places.target, written as typeof pages.$inferSelect);
  }
});

/** The localized values of an entity: its source's text translated, by kind of entity. */
const localize = Effect.fn("translation.localize")(function* (
  db: Database,
  places: Places,
  entity: TranslationJob["entity"],
  source: Row,
) {
  switch (entity) {
    case "page":
      return yield* localizePage(db, places, source as typeof pages.$inferSelect);
    case "block":
    case "sharedContent": {
      const row = source as Row & { projectId: number; type: string; content: unknown };
      const schemas = yield* loadDefinitionSchemas(
        db,
        { projectId: row.projectId, type: row.type },
        places.draft,
      );
      return { content: yield* translateContent(places, schemas?.contentSchema, row.content) };
    }
    case "repeatableItem": {
      const item = source as typeof repeatableItems.$inferSelect;
      const schema = yield* itemContentSchema(db, places.draft, item);
      return { content: yield* translateContent(places, schema, item.content) };
    }
    case "record":
      return yield* localizeRecord(db, places, source as typeof collectionRecords.$inferSelect);
  }
});

/** Asks the model for texts' translations, unless there are none to translate. */
const ask = Effect.fn("translation.ask")(function* (places: Places, texts: TranslationText[]) {
  if (texts.length === 0) return {} as Translations;
  const model = yield* AiModel;
  return yield* model.translate({ from: places.from, to: places.to, texts });
});

const translateContent = Effect.fn("translation.content")(function* (
  places: Places,
  schema: unknown,
  content: unknown,
) {
  if (content === null || typeof content !== "object" || Array.isArray(content)) return content;
  const { texts, translated } = contentTexts(schema, content as Record<string, unknown>);
  return translated(yield* ask(places, texts));
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
  places: Places,
  page: typeof pages.$inferSelect,
) {
  const texts: TranslationText[] = [];
  if (page.pathSegment !== "")
    texts.push({ key: "pathSegment", text: page.pathSegment, format: "slug" });
  for (const key of ["metaTitle", "metaDescription"] as const) {
    const text = page[key];
    if (text) texts.push({ key, text, format: "plain" });
  }
  const translations = yield* ask(places, texts);

  const parent =
    page.parentPageId === null
      ? undefined
      : ((yield* overlay.get(db, places.target, pages, page.parentPageId)) ??
        (yield* overlay.get(db, places.draft, pages, page.parentPageId)));
  const parentPath = parent?.fullPath ?? "";
  const segment = page.pathSegment === "" ? "" : slugOf(translations.pathSegment, page.pathSegment);
  const taken = new Set(
    (yield* overlay.select(
      db,
      places.target,
      pages,
      and(eq(pages.projectId, page.projectId), ne(pages.id, page.id)),
    )).map((other) => other.fullPath),
  );
  let pathSegment = segment;
  for (let n = 2; taken.has(joinPath(parentPath, pathSegment)); n++) {
    pathSegment = `${segment}-${n}`;
  }
  return {
    pathSegment,
    fullPath: joinPath(parentPath, pathSegment),
    metaTitle: page.metaTitle && (translations.metaTitle ?? page.metaTitle),
    metaDescription: page.metaDescription && (translations.metaDescription ?? page.metaDescription),
  };
});

/** Rewrites the full paths of a page localization's descendants under its new path. */
const movePageDescendants = Effect.fn("translation.movePageDescendants")(function* (
  db: Database,
  target: Draft,
  page: typeof pages.$inferSelect,
) {
  const all = yield* overlay.select(db, target, pages, eq(pages.projectId, page.projectId));
  const seen = new Set([page.id]);
  const queue = [{ id: page.id, fullPath: page.fullPath }];
  for (let parent = queue.shift(); parent; parent = queue.shift()) {
    for (const child of all.filter((other) => other.parentPageId === parent!.id)) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      const fullPath = joinPath(parent.fullPath, child.pathSegment);
      if (fullPath !== child.fullPath) {
        yield* overlay.update(db, target, pages, child.id, { fullPath, updatedAt: Date.now() });
      }
      queue.push({ id: child.id, fullPath });
    }
  }
});

/**
 * A record's translated content. A value its record pages are found by, such as a slug, gets a
 * number where another record of the collection has it in the locale.
 */
const localizeRecord = Effect.fn("translation.record")(function* (
  db: Database,
  places: Places,
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
          definitionsIn(collectionDefinitions, places.draft),
        ),
      )
      .get(),
  );
  const content = (yield* translateContent(
    places,
    definition?.contentSchema,
    record.content,
  )) as Record<string, unknown> | null;
  if (!content) return { content: record.content };

  const foundBy = (yield* recordPageLayouts(db, {
    projectId: record.projectId,
    draft: places.draft,
  }))
    .filter((layout) => layout.collectionId === record.collectionId)
    .map((layout) => layout.field);
  if (foundBy.length === 0) return { content };
  const others = yield* overlay.select(
    db,
    places.target,
    collectionRecords,
    and(
      eq(collectionRecords.projectId, record.projectId),
      eq(collectionRecords.collectionId, record.collectionId),
      ne(collectionRecords.id, record.id),
    ),
  );
  for (const field of new Set(foundBy)) {
    const value = content[field];
    if (typeof value !== "string" || pageValue(content, field) === null) continue;
    const taken = new Set(others.map((other) => pageValue(other.content, field)));
    let unique = value;
    for (let n = 2; taken.has(unique); n++) unique = `${value}-${n}`;
    content[field] = unique;
  }
  return { content };
});
