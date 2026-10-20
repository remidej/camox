import { and, eq, isNull, type SQL, sql } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { Effect } from "effect";

import type { Database } from "../../db";
import type { ReadScope } from "../drafts/scope";
import { INITIAL_LOCALE, locales } from "./schema";

// A project's default locale, as values that differ per locale need it (ADR 0015). Drafts never
// change which locale is the default, so these read Live's. Where a locale is optional, the
// default locale is named by no tag at all: `otherLocale` turns the default's tag into none, so
// both ways of naming it lead to the same value.

/** The tag of a project's default locale, as a scalar subquery. */
export const defaultLocaleOf = (projectId: SQL | AnySQLiteColumn | number): SQL =>
  sql`(select ${locales.tag} from ${locales} where ${locales.projectId} = ${projectId} and ${locales.isDefault} = 1 and ${locales.draftId} is null)`;

/** The tag of a project's default locale. */
export const defaultLocaleTag = Effect.fn("locales.defaultLocaleTag")(function* (
  db: Database,
  projectId: number,
) {
  const row = yield* Effect.promise(() =>
    db
      .select({ tag: locales.tag })
      .from(locales)
      .where(
        and(eq(locales.projectId, projectId), eq(locales.isDefault, true), isNull(locales.draftId)),
      )
      .get(),
  );
  return row?.tag;
});

/** A locale's tag unless it's the project's default locale, which it turns into none. */
export const otherLocale = Effect.fn("locales.otherLocale")(function* (
  db: Database,
  projectId: number,
  tag: string | undefined,
) {
  if (tag === undefined) return undefined;
  return tag === (yield* defaultLocaleTag(db, projectId)) ? undefined : tag;
});

/** The locale a scope reads a project in, unless it's the default one: its tag, or undefined. */
export const otherLocaleOf = (db: Database, scope: ReadScope, projectId: number) =>
  otherLocale(db, projectId, scope?.locale);

/** The tag of the locale a scope reads a project in: the one it names, or the default locale's. */
export const localeTagOf = Effect.fn("locales.localeTagOf")(function* (
  db: Database,
  scope: ReadScope,
  projectId: number,
) {
  return scope?.locale ?? (yield* defaultLocaleTag(db, projectId)) ?? INITIAL_LOCALE;
});
