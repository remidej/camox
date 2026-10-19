import { CAMOX_ACTOR, CAMOX_NAME, type EndedDraft } from "@camox/api-contract/drafts";
import { generateUuidv7 } from "@camox/api-contract/ids";
import { and, desc, eq, not, sql } from "drizzle-orm";
import { Effect } from "effect";

import type { TranslationJob } from "../../lib/ai-job-queue";
import { record } from "../../lib/journal";
import type { ServiceContext } from "../_shared/service-context";
import { user as users } from "../auth/schema";
import { locales } from "../locales/schema";
import {
  type PendingTranslation,
  requestTranslations,
  type Translatable,
} from "../translations/service";
import * as overlay from "./overlay";
import { drafts, endedDrafts } from "./schema";
import { draftOf, type Draft, type DraftScope } from "./scope";

// Drafts' lifecycle outside a request: starting, dropping and finding how one ended. Requests
// reach their draft through content access (`access.ts`).

/** How a project's draft ended and who ended it, or undefined while it hasn't ended. */
export const findEndedDraft = Effect.fn("findEndedDraft")(function* (
  db: ServiceContext["db"],
  projectId: number,
  draftId: string,
) {
  const row = yield* Effect.promise(() =>
    db
      .select({ ended: endedDrafts, name: users.name })
      .from(endedDrafts)
      .leftJoin(users, eq(users.id, endedDrafts.endedBy))
      .where(and(eq(endedDrafts.id, draftId), eq(endedDrafts.projectId, projectId)))
      .get(),
  );
  if (!row) return undefined;
  const { ended, name } = row;
  return {
    draftId: ended.id,
    outcome: ended.outcome,
    endedBy: {
      id: ended.endedBy,
      name: ended.endedBy === CAMOX_ACTOR ? CAMOX_NAME : (name ?? "A former member"),
    },
    endedAt: ended.endedAt,
  } satisfies EndedDraft;
});

/**
 * Creates a regular draft unless its id is taken or belonged to a draft that ended, so an ended
 * draft never comes back. Whether this call created it.
 */
export const startDraft = Effect.fn("startDraft")(function* (
  db: ServiceContext["db"],
  draft: { id: string; projectId: number; createdBy: string; name: string | null },
) {
  // Two requests racing to start the same draft both land here; the primary key keeps one.
  // The insert skips an ended draft's id in the same statement, so it can't race an ending.
  const inserted = yield* Effect.promise(() =>
    db.run(sql`
      insert into ${drafts} (id, project_id, kind, name, created_by, created_at)
      select ${draft.id}, ${draft.projectId}, 'regular', ${draft.name}, ${draft.createdBy}, ${Date.now()}
      where not exists (select 1 from ${endedDrafts} where ${endedDrafts.id} = ${draft.id})
      on conflict do nothing`),
  );
  const started = inserted.meta.changes > 0;
  if (started) yield* record(db, { kind: "drafts", projectId: draft.projectId });
  return started;
});

/** Deletes a draft in one statement, only while it stores nothing. */
export const dropIfEmpty = (db: ServiceContext["db"], scope: Draft) =>
  Effect.promise(() =>
    db.delete(drafts).where(and(eq(drafts.id, scope.id), not(overlay.storesAnything(scope)))),
  );

/**
 * The scope a background job scheduled from `draftId` runs in: Live for `null`, or undefined
 * when the draft has ended since, so the job does nothing (ADR 0012).
 */
export const draftScopeOfJob = Effect.fn("draftScopeOfJob")(function* (
  db: ServiceContext["db"],
  draftId: string | null,
) {
  if (draftId === null) return null satisfies DraftScope;
  const draft = yield* Effect.promise(() =>
    db.select().from(drafts).where(eq(drafts.id, draftId)).get(),
  );
  if (!draft) return undefined;
  return draftOf(draft);
});

// --- Catch-up drafts (ADR 0015) ---
//
// Translations a draft published without carry on in a draft Camox opens: they run against the
// new Live, and Camox publishes the draft once they're done (`publishWhenTranslated`). One
// catch-up draft per project is open at a time; later catch-ups join it.

/** Whether Camox opened a draft, to catch translations up. */
export const isCatchUpDraft = (row: { kind: string; createdBy: string }) =>
  row.kind === "regular" && row.createdBy === CAMOX_ACTOR;

/** The project's open catch-up draft, opened now when there's none. */
export const openCatchUpDraft = Effect.fn("drafts.openCatchUpDraft")(function* (
  db: ServiceContext["db"],
  projectId: number,
) {
  const open = () =>
    Effect.promise(() =>
      db
        .select()
        .from(drafts)
        .where(
          and(
            eq(drafts.projectId, projectId),
            eq(drafts.kind, "regular"),
            eq(drafts.createdBy, CAMOX_ACTOR),
          ),
        )
        .orderBy(desc(drafts.createdAt))
        .get(),
    );
  const existing = yield* open();
  if (existing) return draftOf(existing);
  const id = generateUuidv7();
  yield* startDraft(db, { id, projectId, createdBy: CAMOX_ACTOR, name: "Translations" });
  return draftOf({ id, projectId, kind: "regular" });
});

/**
 * Requests the translation of default-locale entities into locales on Live (every one but the
 * default when `locales` is missing) in the project's catch-up draft. Opens no draft when there's
 * nothing to translate; otherwise returns it.
 */
export const catchUp = Effect.fn("drafts.catchUp")(function* (
  db: ServiceContext["db"],
  projectId: number,
  entities: readonly Translatable[],
  targets?: readonly string[],
  options: { source?: TranslationJob["source"] } = {},
) {
  const live = yield* overlay.select(db, null, locales, eq(locales.projectId, projectId));
  const others = live.filter((locale) => !locale.isDefault).map((locale) => locale.tag);
  const into = targets ? targets.filter((tag) => others.includes(tag)) : others;
  if (entities.length === 0 || into.length === 0) return undefined;
  const draft = yield* openCatchUpDraft(db, projectId);
  yield* requestTranslations(db, draft, entities, into, { immediately: true, ...options });
  return draft;
});

/** Carries translations a draft published without over to the project's catch-up draft. */
export const catchUpPending = Effect.fn("drafts.catchUpPending")(function* (
  db: ServiceContext["db"],
  projectId: number,
  pending: readonly PendingTranslation[],
) {
  const groups = new Map<string, PendingTranslation[]>();
  for (const translation of pending) {
    // A merge with Live's localization is moot once the draft's localization is Live's.
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
