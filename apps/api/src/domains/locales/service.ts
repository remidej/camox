import { and, eq, ne } from "drizzle-orm";
import { Effect } from "effect";
import { z } from "zod";

import type { Database } from "../../db";
import { ConflictError, decodeInput, InvalidInputError, NotFoundError } from "../../lib/errors";
import { record } from "../../lib/journal";
import type { ServiceContext } from "../_shared/service-context";
import { accessTo } from "../drafts/access";
import * as overlay from "../drafts/overlay";
import { draftOf, inLocale, type Draft, type ReadScope } from "../drafts/scope";
import { files } from "../files/schema";
import { type GenerationTarget, requestGenerations } from "../generated-values/generation";
import { homeOf, retagStatements as retagValueStatements } from "../generated-values/service";
import { pages } from "../pages/schema";
import { namingProject, projectRefOf, type ProjectRef } from "../projects/ref";
import * as translations from "../translations/service";
import { INITIAL_LOCALE, locales } from "./schema";

// Locales are content (ADR 0015): a draft adds and removes them, and publishing puts them on
// Live. Adding a locale gives it a localization of every entity in the default locale, a copy
// keeping its original's id; removing one takes every localization in it along.

/**
 * Gives a new project its default locale on Live, as the migration gave existing projects. No
 * member published it, so it never counts as Live's latest publish.
 */
export function insertInitialLocale(db: Database, projectId: number, now: number) {
  return db.insert(locales).values({
    projectId,
    tag: INITIAL_LOCALE,
    isDefault: true,
    createdAt: now,
    updatedAt: now,
  });
}

// --- Input Schemas ---

const tagSchema = z
  .string()
  .trim()
  .min(1)
  .describe('A BCP 47 language tag, such as "de" or "pt-BR".');

/** A project by its internal id, or as a website's code names it. */
export const listLocalesInput = z.union([z.object({ projectId: z.number() }), namingProject({})]);
export const addLocaleInput = z.object({ projectId: z.number(), tag: tagSchema });
export const removeLocaleInput = z.object({ projectId: z.number(), tag: tagSchema });
export const setDefaultLocaleTagInput = z.object({ projectId: z.number(), tag: tagSchema });

/** A locale as people and agents see it. */
export type LocaleView = { tag: string; isDefault: boolean };

type LocaleRow = typeof locales.$inferSelect;

const view = (row: LocaleRow): LocaleView => ({ tag: row.tag, isDefault: row.isDefault });

/** A tag in its canonical form, so `pt-br` and `pt-BR` name one locale. */
const canonicalTag = (tag: string) =>
  Effect.try({
    try: () => {
      const [canonical] = Intl.getCanonicalLocales(tag);
      if (!canonical) throw new RangeError(tag);
      return canonical;
    },
    catch: () =>
      new InvalidInputError({
        message: `"${tag}" isn't a BCP 47 language tag, such as "de" or "pt-BR"`,
        data: { tag },
      }),
  });

/** The locales a scope reads in a project: the default locale first, then by when they were added. */
const localesIn = (db: Database, scope: ReadScope, projectId: number) =>
  overlay
    .select(db, scope, locales, eq(locales.projectId, projectId))
    .pipe(
      Effect.map((rows) =>
        rows.sort(
          (a, b) =>
            Number(b.isDefault) - Number(a.isDefault) ||
            a.createdAt - b.createdAt ||
            (a.tag < b.tag ? -1 : 1),
        ),
      ),
    );

/** The locale with a tag among `rows`, whatever its case. */
const withTag = (rows: LocaleRow[], tag: string) =>
  rows.find((row) => row.tag.toLowerCase() === tag.toLowerCase());

/**
 * Access to a project for managing its locales. The request's own locale doesn't matter: these
 * services name the locale they act on.
 */
const projectAccess = <M extends "public" | "member" | "write">(
  ctx: ServiceContext,
  project: number | ProjectRef,
  mode: M,
) =>
  accessTo(
    { ...ctx, locale: undefined },
    typeof project === "number" ? { project } : project,
    mode,
  );

// --- Reads ---

/** The locales the request's draft reads, or Live's: the default locale first. */
export const listLocales = Effect.fn("locales.list")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof listLocalesInput>,
) {
  const input = yield* decodeInput(listLocalesInput, rawInput);
  const { scope, project } = yield* Effect.scoped(
    projectAccess(ctx, "projectId" in input ? input.projectId : projectRefOf(input), "public"),
  );
  return (yield* localesIn(ctx.db, scope, project.id)).map(view);
});

// --- Writes ---

/**
 * Adds a locale in the request's draft, with a localization of every entity the draft reads in
 * the default locale. Adding back a Live locale the draft removed drops the removal instead, so
 * the draft reads Live's content in it again.
 */
export const addLocale = Effect.fn("locales.add")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof addLocaleInput>,
) {
  const { projectId, tag: requested } = yield* decodeInput(addLocaleInput, rawInput);
  const tag = yield* canonicalTag(requested);
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const { scope } = yield* projectAccess(ctx, projectId, "write");
      const draft = draftOf(scope);
      if (withTag(yield* localesIn(ctx.db, draft, projectId), tag)) {
        return yield* new ConflictError({ message: `The draft already has the "${tag}" locale` });
      }

      const removed = yield* removedFromLive(ctx.db, draft, tag);
      if (removed) {
        // The draft's translation state goes with its content, so Live's localizations aren't
        // merged against bookkeeping of what the draft wrote.
        yield* overlay.runStatements(ctx.db, [
          ...overlay.dropLocaleStatements(ctx.db, draft, removed.tag),
          ...translations.dropLocaleStatements(ctx.db, draft, removed.tag),
        ]);
        yield* overlay.revert(ctx.db, draft, locales, removed.id);
        return view({ ...removed, deleted: false });
      }

      const now = Date.now();
      yield* overlay.runStatements(ctx.db, [
        ...overlay.dropLocaleStatements(ctx.db, draft, tag),
        ...overlay.localizeStatements(draft, tag, now),
      ]);
      const added = yield* overlay.insert(ctx.db, draft, locales, {
        projectId,
        tag,
        isDefault: false,
        createdAt: now,
        updatedAt: now,
      });
      if (!added) {
        return yield* new ConflictError({ message: `The draft already has the "${tag}" locale` });
      }
      // Camox fills the new locale with a translation of the whole website.
      yield* translations.translateIntoLocale(ctx.db, draft, tag);
      yield* requestLocaleGeneration(ctx.db, inLocale(draft, tag));
      return view(added);
    }),
  );
});

/**
 * Requests the values generated in each locale (ADR 0012) for a locale a draft added: the SEO
 * of its pages, and the alt text of the project's files.
 */
const requestLocaleGeneration = Effect.fn("locales.requestGeneration")(function* (
  db: Database,
  scope: Draft,
) {
  const home = homeOf(scope, scope.projectId);
  const pageRows = yield* overlay.select(db, scope, pages, eq(pages.projectId, scope.projectId));
  const fileRows = yield* overlay.select(db, scope, files, eq(files.projectId, scope.projectId));
  const targets: GenerationTarget[] = [
    ...pageRows.map((row) => ({ entity: "page" as const, row })),
    ...fileRows.map((row) => ({ entity: "file" as const, row })),
  ];
  yield* requestGenerations(
    db,
    targets.map((target) => ({ home, target })),
  );
});

/** The tombstone a draft stores for a Live locale with this tag, whatever its case. */
const removedFromLive = Effect.fn("locales.removedFromLive")(function* (
  db: Database,
  draft: Draft,
  tag: string,
) {
  const tombstones = yield* Effect.promise(() =>
    db
      .select()
      .from(locales)
      .where(
        and(
          overlay.storedIn(locales, draft),
          eq(locales.projectId, draft.projectId),
          eq(locales.deleted, true),
        ),
      ),
  );
  return withTag(tombstones, tag);
});

/**
 * Removes a locale in the request's draft, with every localization in it: the draft's own are
 * dropped now, and Live's are deleted for good when the draft publishes. The default locale
 * can't be removed.
 */
export const removeLocale = Effect.fn("locales.remove")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof removeLocaleInput>,
) {
  const { projectId, tag: requested } = yield* decodeInput(removeLocaleInput, rawInput);
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const { scope } = yield* projectAccess(ctx, projectId, "write");
      const draft = draftOf(scope);
      // The draft's own locale first: Live may have the tag too, since another draft published it.
      const tagged = (yield* localesIn(ctx.db, draft, projectId)).filter((row) =>
        withTag([row], requested),
      );
      const locale = tagged.find((row) => row.draftId === draft.id) ?? tagged[0];
      if (!locale) {
        return yield* new NotFoundError({
          message: `The draft has no locale "${requested}"`,
          data: { locale: requested },
        });
      }
      if (locale.isDefault) {
        return yield* new InvalidInputError({
          message: `"${locale.tag}" is the default locale, which can't be removed`,
        });
      }
      yield* overlay.runStatements(ctx.db, [
        ...overlay.dropLocaleStatements(ctx.db, draft, locale.tag),
        ...translations.dropLocaleStatements(ctx.db, draft, locale.tag),
      ]);
      yield* overlay.remove(ctx.db, draft, locales, locale.id);
      return view(locale);
    }),
  );
});

/**
 * Corrects the default locale's tag while it's the project's only locale, on Live and in every
 * draft at once: no draft holds the change, since the content stays the same (ADR 0015). Refused
 * once another locale exists, on Live or in any draft.
 */
export const setDefaultLocaleTag = Effect.fn("locales.setDefaultTag")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof setDefaultLocaleTagInput>,
) {
  const { projectId, tag: requested } = yield* decodeInput(setDefaultLocaleTagInput, rawInput);
  const tag = yield* canonicalTag(requested);
  yield* Effect.scoped(projectAccess(ctx, projectId, "member"));
  const [current] = yield* localesIn(ctx.db, null, projectId);
  if (!current) return yield* new NotFoundError();
  if (current.tag === tag) return view(current);
  const others = yield* Effect.promise(() =>
    ctx.db
      .select({ tag: locales.tag })
      .from(locales)
      .where(and(eq(locales.projectId, projectId), ne(locales.tag, current.tag)))
      .limit(1),
  );
  if (others.length > 0) {
    return yield* new InvalidInputError({
      message: `The default locale's tag can only change while it's the only locale, and "${others[0]!.tag}" exists`,
    });
  }
  yield* overlay.runStatements(ctx.db, [
    ...overlay.retagStatements(ctx.db, projectId, current.tag, tag),
    ...retagValueStatements(ctx.db, projectId, current.tag, tag),
  ]);
  yield* record(ctx.db, {
    kind: "content",
    entity: "locale",
    id: current.id,
    projectId,
    draftId: null,
    change: "changed",
    row: { ...current, tag },
  });
  return view({ ...current, tag });
});
