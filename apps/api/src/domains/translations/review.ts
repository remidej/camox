import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { Effect } from "effect";

import type { Database } from "../../db";
import { TRANSLATED_ENTITIES, type TranslatedEntity } from "../../lib/ai-job-queue";
import * as overlay from "../drafts/overlay";
import { type Draft, inDefaultLocale } from "../drafts/scope";
import { defaultLocaleTag } from "../locales/default-locale";
import type { Values } from "./bookkeeping";
import { valuesOf } from "./job";
import { sameValue } from "./merge";
import { translationBookkeeping } from "./schema";

// What a draft's review lists (ADR 0015): the changes people and agents made, not every
// localization Camox wrote from them. A localization that still holds what Camox wrote is left
// out, so changing one source reads as one change whatever the number of locales. Hand edits to
// localizations, content in one locale only, and locales added or removed are listed.

// D1 binds at most 100 parameters per statement.
const ID_CHUNK = 90;

const translated = new Set<string>(TRANSLATED_ENTITIES);

const keyOf = (entity: string, id: string, locale: string) => JSON.stringify([entity, id, locale]);

const localeOf = (change: overlay.StoredChange) =>
  "locale" in change.row && typeof change.row.locale === "string" ? change.row.locale : null;

/**
 * The stored changes of a draft that its review lists, leaving out the localizations Camox wrote:
 * - a localization holding what Camox last wrote into it, by its bookkeeping;
 * - a localization Camox copied from its source and hasn't translated yet;
 * - a localization deleted along with its source.
 */
export const listedChanges = Effect.fn("translations.listedChanges")(function* (
  db: Database,
  scope: Draft,
  stored: overlay.StoredChange[],
) {
  const defaultTag = yield* defaultLocaleTag(db, scope.projectId);
  const localizations = stored.filter((change) => {
    const locale = localeOf(change);
    return locale !== null && locale !== defaultTag && translated.has(change.entity);
  });
  if (localizations.length === 0) return stored;

  const deletedSources = new Set(
    stored
      .filter((change) => change.change === "deleted" && localeOf(change) === defaultTag)
      .map((change) => `${change.entity}:${change.row.id}`),
  );
  const outputs = yield* outputsOf(db, scope, localizations);
  const sources = yield* sourcesOf(db, scope, localizations);

  const writtenByCamox = (change: overlay.StoredChange) => {
    const locale = localeOf(change)!;
    if (change.change === "deleted") return deletedSources.has(`${change.entity}:${change.row.id}`);
    const values = valuesOf(change.row as Record<string, unknown> & { id: string });
    const output = outputs.get(keyOf(change.entity, change.row.id, locale));
    if (output) return sameValue(values, output);
    // Without bookkeeping, a localization the draft created as a copy of its source is waiting
    // for its translation.
    const source = sources.get(`${change.entity}:${change.row.id}`);
    return change.change === "created" && !!source && sameValue(values, source);
  };
  const left = new Set(localizations.filter(writtenByCamox));
  return stored.filter((change) => !left.has(change));
});

/**
 * What Camox last wrote into each of these localizations, by key: the draft's own bookkeeping,
 * or Live's.
 */
const outputsOf = Effect.fn("translations.outputsOf")(function* (
  db: Database,
  scope: Draft,
  localizations: overlay.StoredChange[],
) {
  const outputs = new Map<string, Values>();
  const ids = [...new Set(localizations.map((change) => change.row.id))];
  for (let start = 0; start < ids.length; start += ID_CHUNK) {
    const rows = yield* Effect.promise(() =>
      db
        .select({
          entity: translationBookkeeping.entity,
          entityId: translationBookkeeping.entityId,
          locale: translationBookkeeping.locale,
          draftId: translationBookkeeping.draftId,
          output: translationBookkeeping.output,
        })
        .from(translationBookkeeping)
        .where(
          and(
            eq(translationBookkeeping.projectId, scope.projectId),
            inArray(translationBookkeeping.entityId, ids.slice(start, start + ID_CHUNK)),
            or(
              eq(translationBookkeeping.draftId, scope.id),
              isNull(translationBookkeeping.draftId),
            ),
          ),
        ),
    );
    // The draft's own over Live's.
    rows.sort((a, b) => Number(a.draftId !== null) - Number(b.draftId !== null));
    for (const row of rows) {
      outputs.set(keyOf(row.entity, row.entityId, row.locale), row.output);
    }
  }
  return outputs;
});

/** The sources of these localizations in the default locale, as the draft reads them. */
const sourcesOf = Effect.fn("translations.sourcesOf")(function* (
  db: Database,
  scope: Draft,
  localizations: overlay.StoredChange[],
) {
  const sources = new Map<string, Values>();
  const byEntity = new Map<TranslatedEntity, Set<string>>();
  for (const change of localizations) {
    if (change.change !== "created") continue;
    const entity = change.entity as TranslatedEntity;
    byEntity.set(entity, (byEntity.get(entity) ?? new Set()).add(change.row.id));
  }
  for (const [entity, idSet] of byEntity) {
    const table = overlay.contentTableOf(entity);
    const ids = [...idSet];
    for (let start = 0; start < ids.length; start += ID_CHUNK) {
      const rows = yield* overlay.select(
        db,
        inDefaultLocale(scope),
        table,
        inArray(table.id, ids.slice(start, start + ID_CHUNK)),
      );
      for (const row of rows) {
        sources.set(
          `${entity}:${row.id}`,
          valuesOf(row as Record<string, unknown> & { id: string }),
        );
      }
    }
  }
  return sources;
});
