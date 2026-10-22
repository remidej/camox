import { uuidv7Schema } from "@camox/api-contract/ids";
import { and, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";
import { z } from "zod";

import { decodeInput, NotFoundError } from "../../lib/errors";
import type { ServiceContext } from "../_shared/service-context";
import { collectionRecords } from "../collections/schema";
import { selectInChunks } from "../content/chunks";
import { contentReader } from "../content/reader";
import { accessTo } from "../drafts/access";
import * as overlay from "../drafts/overlay";
import { inDefaultLocale, type ReadScope } from "../drafts/scope";
import { pages } from "../pages/schema";
import { addLocalizationBack } from "../translations/exclusions";
import { localizationExclusions } from "../translations/schema";

// The pages and collection records deleted from a locale, which translation keeps out of it
// (ADR 0015), and adding them back. Both act in the locale the request names.

/** The kinds of entity a member adds back to a locale: what's beneath them comes along. */
const MISSING_ENTITIES = ["page", "record"] as const;

export const listMissingFromLocaleInput = z.object({ projectId: z.number() });
export const addBackToLocaleInput = z.object({
  projectId: z.number(),
  entity: z.enum(MISSING_ENTITIES).describe("What to add back: a page or a collection record."),
  id: uuidv7Schema.describe("The id of the page or record, the same in every locale."),
});

/** A page missing from a locale, as the default locale shows it. */
export type MissingPage = { id: string; fullPath: string; nickname: string };
/** A record missing from a locale, as the default locale shows it. */
export type MissingRecord = { id: string; collectionId: string; title: string };

/** The scope's exclusions of the kinds a member adds back. */
const exclusionsIn = (ctx: ServiceContext, scope: ReadScope, projectId: number) =>
  overlay.select(
    ctx.db,
    scope,
    localizationExclusions,
    and(
      eq(localizationExclusions.projectId, projectId),
      inArray(localizationExclusions.entity, [...MISSING_ENTITIES]),
    ),
  );

/**
 * The pages and records deleted from the locale the request reads, as the default locale shows
 * them: pages by path, records by collection and title. A page deleted from the locale beneath
 * another one deleted from it is listed once the page above it is added back, which leaves it
 * deleted. The default locale misses nothing.
 */
export const listMissingFromLocale = Effect.fn("locales.listMissing")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof listMissingFromLocaleInput>,
) {
  const { projectId } = yield* decodeInput(listMissingFromLocaleInput, rawInput);
  const { scope } = yield* accessTo(ctx, { project: projectId }, "member");
  const exclusions = yield* exclusionsIn(ctx, scope, projectId);
  const excluded = new Set(exclusions.map(({ id }) => id));
  const original = inDefaultLocale(scope);

  const pageIds = exclusions.filter(({ entity }) => entity === "page").map(({ id }) => id);
  const allPages = pageIds.length
    ? yield* overlay.select(ctx.db, original, pages, eq(pages.projectId, projectId))
    : [];
  const pageById = new Map(allPages.map((page) => [page.id, page]));
  const beneathExcluded = (page: typeof pages.$inferSelect) => {
    const seen = new Set([page.id]);
    for (let id = page.parentPageId; id !== null && !seen.has(id);) {
      if (excluded.has(id)) return true;
      seen.add(id);
      id = pageById.get(id)?.parentPageId ?? null;
    }
    return false;
  };
  const missingPages: MissingPage[] = pageIds
    .map((id) => pageById.get(id))
    .filter((page) => page !== undefined && !beneathExcluded(page))
    .map((page) => ({ id: page!.id, fullPath: page!.fullPath, nickname: page!.nickname }))
    .sort((a, b) => (a.fullPath < b.fullPath ? -1 : a.fullPath > b.fullPath ? 1 : 0));

  const recordIds = exclusions.filter(({ entity }) => entity === "record").map(({ id }) => id);
  const recordRows = yield* selectInChunks(
    ctx.db,
    original,
    collectionRecords,
    recordIds,
    (chunk) =>
      and(eq(collectionRecords.projectId, projectId), inArray(collectionRecords.id, chunk)),
  );
  const reader = contentReader(ctx, { projectId, draft: original });
  const missingRecords: MissingRecord[] = [];
  for (const collectionId of [...new Set(recordRows.map((row) => row.collectionId))].sort()) {
    const shown = yield* reader.shown.records(collectionId, recordRows);
    missingRecords.push(
      ...shown
        .map(({ id, title }) => ({ id, collectionId, title }))
        .sort((a, b) => a.title.localeCompare(b.title)),
    );
  }
  return { pages: missingPages, records: missingRecords };
}, Effect.scoped);

/**
 * Adds a page or record deleted from the locale the request writes back to it, in the request's
 * draft, with everything beneath it: Camox translates it from the default locale again, and keeps
 * translating its changes. Only what's missing from the locale can be added back.
 */
export const addBackToLocale = Effect.fn("locales.addBack")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof addBackToLocaleInput>,
) {
  const { projectId, entity, id } = yield* decodeInput(addBackToLocaleInput, rawInput);
  const { scope } = yield* accessTo(ctx, { project: projectId }, "write");
  const missing = { message: `This ${entity} isn't missing from the locale`, data: { id } };
  if (scope.locale === undefined) return yield* new NotFoundError(missing);
  const [exclusion] = yield* overlay.select(
    ctx.db,
    scope,
    localizationExclusions,
    and(eq(localizationExclusions.id, id), eq(localizationExclusions.entity, entity)),
  );
  if (!exclusion) return yield* new NotFoundError(missing);
  yield* addLocalizationBack(ctx.db, { ...scope, locale: scope.locale }, entity, id);
  return { entity, id };
}, Effect.scoped);
