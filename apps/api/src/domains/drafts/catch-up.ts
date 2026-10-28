import { CAMOX_ACTOR } from "@camox/api-contract/drafts";
import { generateUuidv7 } from "@camox/api-contract/ids";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";

import type { Database } from "../../db";
import type { TranslationJob } from "../../lib/ai-job-queue";
import { Journal } from "../../lib/journal";
import { defaultLocaleTag } from "../locales/default-locale";
import { locales } from "../locales/schema";
import {
  isTranslated,
  type PendingTranslation,
  requestTranslations,
  type Translatable,
} from "../translations/service";
import * as overlay from "./overlay";
import { drafts } from "./schema";
import { draftOf } from "./scope";
import { startDraft } from "./service";

// Catch-up drafts (ADR 0017). Translations a draft published without, and translations of what
// a release wrote on Live, carry on in a draft Camox opens: they run against the new Live, and
// Camox publishes the draft once they're done (`publishWhenTranslated`). A project has at most
// one catch-up draft open at a time, which later catch-ups join.

/** The name of the drafts Camox opens to catch translations up. */
export const CATCH_UP_DRAFT_NAME = "Translations";

/** Whether Camox opened a draft, to catch translations up. */
export const isCatchUpDraft = (row: { createdBy: string }) => row.createdBy === CAMOX_ACTOR;

/** The project's open catch-up draft's row, if any. */
export const catchUpDraftOf = (db: Database, projectId: number) =>
  Effect.promise(() =>
    db
      .select()
      .from(drafts)
      .where(and(eq(drafts.projectId, projectId), eq(drafts.createdBy, CAMOX_ACTOR)))
      .get(),
  );

/**
 * The project's open catch-up draft, opened now when there's none. Requests racing to open one
 * get the same: the database keeps one open per project.
 */
export const openCatchUpDraft = Effect.fn("drafts.openCatchUpDraft")(function* (
  db: Database,
  projectId: number,
) {
  const open = () => catchUpDraftOf(db, projectId);
  const existing = yield* open();
  if (existing) return draftOf(existing);
  yield* startDraft(db, {
    id: generateUuidv7(),
    projectId,
    createdBy: CAMOX_ACTOR,
    name: CATCH_UP_DRAFT_NAME,
  });
  // This request's draft, or the one a racing request opened first.
  const opened = yield* open();
  if (!opened) return yield* Effect.die(new Error("No catch-up draft after opening one"));
  return draftOf(opened);
});

/** How many times a catch-up retries in a new draft when its draft ended under it. */
const ATTEMPTS = 3;

/**
 * Requests the translation of default-locale entities into locales on Live (every one but the
 * default when `targets` is missing) in the project's catch-up draft. Opens no draft when there's
 * nothing to translate; otherwise returns it. When Camox published the draft in the meantime,
 * they're requested in a new one.
 */
export const catchUp = Effect.fn("drafts.catchUp")(function* (
  db: Database,
  projectId: number,
  entities: readonly Translatable[],
  targets?: readonly string[],
  options: { source?: TranslationJob["source"] } = {},
) {
  const live = yield* overlay.select(db, null, locales, eq(locales.projectId, projectId));
  const others = live.filter((locale) => !locale.isDefault).map((locale) => locale.tag);
  const into = targets ? targets.filter((tag) => others.includes(tag)) : others;
  if (entities.length === 0 || into.length === 0) return undefined;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const draft = yield* openCatchUpDraft(db, projectId);
    const requested = yield* requestTranslations(db, draft, entities, into, {
      immediately: true,
      ...options,
    });
    if (requested) return draft;
  }
  return yield* Effect.die(new Error("Catch-up drafts kept ending before their translations"));
});

/**
 * Requests the translation of every default-locale entity a release wrote on Live into Live's
 * other locales, in the project's catch-up draft. Runs once the work succeeded, with its journal.
 * A release syncs in several requests; each joins the one open catch-up draft.
 */
export const catchUpReleaseWrites = Effect.fn("drafts.catchUpReleaseWrites")(function* () {
  const { db, changes } = yield* Journal;
  if (!db) return;
  const byProject = new Map<number, Map<string, Translatable & { locale: string }>>();
  for (const change of changes) {
    if (change.kind !== "localizedWrite" || change.draftId !== null) continue;
    if (!isTranslated(change.entity)) continue;
    const writes = byProject.get(change.projectId) ?? new Map();
    const { entity, id, locale } = change;
    writes.set(JSON.stringify([entity, id, locale]), { entity, id, locale });
    byProject.set(change.projectId, writes);
  }
  for (const [projectId, writes] of byProject) {
    const defaultTag = yield* defaultLocaleTag(db, projectId);
    const entities = [...writes.values()]
      .filter(({ locale }) => locale === defaultTag)
      .map(({ entity, id }) => ({ entity, id }));
    yield* catchUp(db, projectId, entities);
  }
});

/**
 * Carries translations a draft published without over to the project's catch-up draft. Merges
 * with Live's localizations (`live`) are dropped: the draft's localization is Live's now, as
 * published anyway (ADR 0016).
 */
export const catchUpPending = Effect.fn("drafts.catchUpPending")(function* (
  db: Database,
  projectId: number,
  pending: readonly PendingTranslation[],
) {
  const groups = new Map<string, PendingTranslation[]>();
  for (const translation of pending) {
    if (translation.source === "live") continue;
    const key = JSON.stringify([translation.locale, translation.source]);
    groups.set(key, [...(groups.get(key) ?? []), translation]);
  }
  for (const group of groups.values()) {
    const { locale, source } = group[0]!;
    const entities = new Map(group.map(({ entity, id }) => [`${entity}:${id}`, { entity, id }]));
    // Code-owned defaults placed in a locale stay translated as such; anything else is a
    // translation of the source as Live now has it.
    yield* catchUp(db, projectId, [...entities.values()], [locale], {
      ...(source === "defaults" && { source }),
    });
  }
});
