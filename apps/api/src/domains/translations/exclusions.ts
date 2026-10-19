import { inArray } from "drizzle-orm";
import { Effect } from "effect";

import type { Database } from "../../db";
import { TRANSLATED_ENTITIES, type TranslatedEntity } from "../../lib/ai-job-queue";
import { blocks, pages, repeatableItems } from "../../schema";
import * as overlay from "../drafts/overlay";
import { type Draft, type DraftInLocale, draftOf, type ReadScope } from "../drafts/scope";
import { localizationExclusions } from "./schema";
import { requestTranslations } from "./service";
import { descendantsOf } from "./subtree";

// Localizations can differ from the default locale in structure (ADR 0015). Deleting a
// localization from its locale records an exclusion, its id in that locale: translation jobs
// leave the excluded entity, and everything beneath it, out of the locale, however its original
// changes. Content created in a locale other than the default one exists only there and is never
// excluded. Exclusions are content kept through the draft overlay, so publishing copies a draft's
// to Live, where they stay.

/**
 * Deletes content from the locale `scope` writes on purpose, as members and the agent do, and
 * returns what it deleted, like `overlay.remove`: a localization deleted so stays out of its
 * locale, with what's beneath it, through its original's changes. Every path deleting content on
 * purpose goes through here; translation deleting the localizations of a deleted original
 * doesn't. Callers delete descendants as `overlay.remove` asks them to: being beneath a deleted
 * localization excludes them already.
 */
export const deleteOnPurpose = Effect.fn("translations.deleteOnPurpose")(function* <
  T extends overlay.ContentTable,
>(db: Database, scope: Draft, table: T, id: string) {
  const removed = yield* overlay.remove(db, scope, table, id);
  const { entity } = overlay.registrationOf(table);
  if (removed && isTranslatedEntity(entity)) yield* excludeLocalization(db, scope, entity, id);
  return removed;
});

const isTranslatedEntity = (entity: string): entity is TranslatedEntity =>
  (TRANSLATED_ENTITIES as readonly string[]).includes(entity);

/**
 * Records that a localization was deleted from the locale `scope` writes, unless the entity
 * isn't a localization there: content of the default locale, or created in the locale only.
 */
const excludeLocalization = Effect.fn("translations.exclude")(function* (
  db: Database,
  scope: Draft,
  entity: TranslatedEntity,
  id: string,
) {
  if (scope.locale === undefined) return;
  const original = yield* overlay.get(db, draftOf(scope), overlay.contentTableOf(entity), id);
  if (!original || (original as { locale: string }).locale === scope.locale) return;
  const stored = yield* overlay.getStored(db, scope, localizationExclusions, id);
  // The draft added the localization back: Live's exclusion holds again.
  if (stored?.deleted) {
    yield* overlay.revert(db, scope, localizationExclusions, id);
    return;
  }
  if (stored) return;
  const now = Date.now();
  // Refused where Live already excludes it.
  yield* overlay.insert(db, scope, localizationExclusions, {
    id,
    projectId: scope.projectId,
    entity,
    createdAt: now,
    updatedAt: now,
  });
});

/** The ids among `ids` that are excluded from the locale `scope` reads. */
export const excludedAmong = Effect.fn("translations.excludedAmong")(function* (
  db: Database,
  scope: ReadScope,
  ids: readonly string[],
) {
  if (ids.length === 0) return new Set<string>();
  const rows = yield* overlay.select(
    db,
    scope,
    localizationExclusions,
    inArray(localizationExclusions.id, [...ids]),
  );
  return new Set(rows.map((row) => row.id));
});

/**
 * Whether a translation job leaves an entity, as the draft reads it in its default locale, out
 * of the locale `target` reads: it's excluded from it, itself or through an entity it sits
 * beneath (its page or parent pages, its block, its parent items), or it sits beneath an entity
 * the draft deleted, whose localizations go with it.
 */
export const isLeftOut = Effect.fn("translations.isLeftOut")(function* (
  db: Database,
  draft: Draft,
  target: DraftInLocale,
  entity: TranslatedEntity,
  row: { id: string },
) {
  const lineage = yield* lineageOf(db, draft, entity, row);
  if (!lineage) return true;
  return (yield* excludedAmong(db, target, lineage)).size > 0;
});

/**
 * An entity's id and the ids of the entities it sits beneath, as `draft` reads them; undefined
 * when one of those is gone.
 */
const lineageOf = Effect.fn("translations.lineageOf")(function* (
  db: Database,
  draft: Draft,
  entity: TranslatedEntity,
  row: { id: string },
) {
  const ids = [row.id];
  let gone = false;
  const pageChain = function* (pageId: string | null) {
    for (let id = pageId; id !== null && !ids.includes(id);) {
      ids.push(id);
      const page = yield* overlay.get(db, draft, pages, id);
      if (!page) gone = true;
      id = page?.parentPageId ?? null;
    }
  };
  const blockChain = function* (blockId: string | null) {
    if (blockId === null || ids.includes(blockId)) return;
    ids.push(blockId);
    const block = yield* overlay.get(db, draft, blocks, blockId);
    if (!block) gone = true;
    yield* pageChain(block?.pageId ?? null);
  };
  if (entity === "page") {
    yield* pageChain((row as typeof pages.$inferSelect).parentPageId);
  } else if (entity === "block") {
    yield* pageChain((row as typeof blocks.$inferSelect).pageId);
  } else if (entity === "repeatableItem") {
    const item = row as typeof repeatableItems.$inferSelect;
    for (let id = item.parentItemId; id !== null && !ids.includes(id);) {
      ids.push(id);
      const parent = yield* overlay.get(db, draft, repeatableItems, id);
      if (!parent) gone = true;
      id = parent?.parentItemId ?? null;
    }
    yield* blockChain(item.blockId);
  }
  return gone ? undefined : ids;
});

/**
 * Adds a deleted localization back to the locale `scope` writes: deletes its exclusion, and
 * requests the translation of the entity and of everything beneath it, which its exclusion kept
 * out of the locale. Exclusions of entities beneath it stay. Localizations the draft itself
 * deleted from the locale get Live's back, which their translation then updates.
 */
export const addLocalizationBack = Effect.fn("translations.addBack")(function* (
  db: Database,
  scope: DraftInLocale,
  entity: TranslatedEntity,
  id: string,
) {
  yield* overlay.remove(db, scope, localizationExclusions, id);
  const draft = draftOf(scope);
  const beneath = yield* descendantsOf(db, draft, { entity, id });
  const subtree = [{ entity, id }, ...beneath.map(({ entity, id }) => ({ entity, id }))];
  const stillExcluded = yield* excludedAmong(
    db,
    scope,
    beneath.map(({ id }) => id),
  );
  for (const member of subtree) {
    if (stillExcluded.has(member.id)) continue;
    const table = overlay.contentTableOf(member.entity);
    const stored = yield* overlay.getStored(db, scope, table, member.id);
    if (stored?.deleted) yield* overlay.revert(db, scope, table, member.id);
  }
  yield* requestTranslations(db, draft, subtree, [scope.locale], { immediately: true });
});
