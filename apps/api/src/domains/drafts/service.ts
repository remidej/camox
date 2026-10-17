import type { EndedDraft } from "@camox/api-contract/drafts";
import { and, eq, inArray, isNull, not, or, type SQL, sql } from "drizzle-orm";
import { Effect } from "effect";

import { getAuthorizedProject, requireUser } from "../../authorization";
import {
  DraftEndedError,
  ForbiddenError,
  LiveReadOnlyError,
  NoDevelopmentDraftError,
  NotFoundError,
  type ServiceError,
} from "../../lib/errors";
import { runService } from "../../lib/run-service";
import type { ServiceContext } from "../_shared/service-context";
import { user as users } from "../auth/schema";
import { findDevelopmentDraft } from "./development";
import * as overlay from "./overlay";
import { drafts, endedDrafts } from "./schema";
import type { Draft, DraftScope } from "./scope";

type DraftScopeContext = Pick<ServiceContext, "db" | "user" | "draft">;

const scopeOf = (draft: typeof drafts.$inferSelect) =>
  ({ id: draft.id, kind: draft.kind, projectId: draft.projectId }) satisfies DraftScope;

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
    endedBy: { id: ended.endedBy, name: name ?? "A former member" },
    endedAt: ended.endedAt,
  } satisfies EndedDraft;
});

/** Fails with the draft's outcome when it ended, and with 404 when it never existed. */
const missingDraft = Effect.fn("missingDraft")(function* (
  db: ServiceContext["db"],
  projectId: number,
  draftId: string,
) {
  const ended = yield* findEndedDraft(db, projectId, draftId);
  if (ended) return yield* new DraftEndedError({ ended });
  return yield* new NotFoundError({
    message: `Draft ${draftId} not found in this project`,
    data: { draftId },
  });
});

/**
 * Live rows of a content table, or rows of the draft a request names, before the request's
 * project is known: for `development`, rows of any of the caller's development drafts.
 */
export function storedForRequest(table: overlay.ContentTable, ctx: DraftScopeContext): SQL {
  const requested = ctx.draft;
  if (!requested) return isNull(table.draftId);
  if (!("development" in requested)) return overlay.storedInLiveOrDraft(table, requested.id);
  if (!ctx.user) return isNull(table.draftId);
  const developmentDrafts = ctx.db
    .select({ id: drafts.id })
    .from(drafts)
    .where(and(eq(drafts.kind, "development"), eq(drafts.createdBy, ctx.user.id)));
  return or(isNull(table.draftId), inArray(table.draftId, developmentDrafts))!;
}

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
  return inserted.meta.changes > 0;
});

/**
 * Turn the draft a request names (`ctx.draft`) into the scope a service reads and writes, once
 * the service knows the project. No draft means Live, which is public. Naming a draft needs a
 * member of the project's organization: anonymous callers fail with 401, outsiders with 403. A
 * missing draft is created with the caller as creator when the request sends the create header
 * (`started`), and fails with 404 otherwise, as does a draft of another project. A draft that
 * was published or discarded fails with its outcome, and the create header never brings it back.
 * `development` names the caller's development draft, which only dev mode creates.
 */
const resolveRequestedDraft = Effect.fn("resolveRequestedDraft")(function* (
  ctx: DraftScopeContext,
  projectId: number,
): Effect.fn.Return<{ scope: DraftScope; started: boolean }, ServiceError> {
  const requested = ctx.draft;
  if (!requested) return { scope: null, started: false };
  const user = yield* requireUser(ctx);
  yield* getAuthorizedProject(ctx.db, projectId, user.id);

  if ("development" in requested) {
    const draft = yield* findDevelopmentDraft(ctx.db, projectId, user.id);
    if (!draft) return yield* new NoDevelopmentDraftError();
    return { scope: scopeOf(draft), started: false };
  }

  const started = requested.create
    ? yield* startDraft(ctx.db, { id: requested.id, projectId, createdBy: user.id, name: null })
    : false;

  const draft = yield* Effect.promise(() =>
    ctx.db.select().from(drafts).where(eq(drafts.id, requested.id)).get(),
  );
  if (draft?.projectId !== projectId) return yield* missingDraft(ctx.db, projectId, requested.id);

  // Regular drafts are open to every member; a development draft only to its owner (ADR 0011).
  if (draft.kind === "development" && draft.createdBy !== user.id) {
    return yield* new ForbiddenError({ message: "A development draft is open to its owner only" });
  }

  return { scope: scopeOf(draft), started };
});

/** The draft scope a request names on a project. Writes go through `inDraftScope`. */
export const resolveDraftScope = (ctx: DraftScopeContext, projectId: number) =>
  Effect.map(resolveRequestedDraft(ctx, projectId), ({ scope }) => scope);

/**
 * The draft a request names on a project, for a content write. Live is read-only (ADR 0003): a
 * request naming no draft fails.
 */
export const resolveWriteDraft = (ctx: DraftScopeContext, projectId: number) =>
  Effect.flatMap(resolveDraftScope(ctx, projectId), (scope) =>
    scope ? Effect.succeed(scope) : Effect.fail(new LiveReadOnlyError()),
  );

/**
 * Runs a service in the draft scope a request names on a project. When this request started the
 * draft and the service fails, the draft is dropped again unless a concurrent write already
 * stored content in it, so a failed first edit leaves no empty draft behind.
 */
export const inDraftScope = <A>(
  ctx: DraftScopeContext,
  projectId: number,
  run: (scope: DraftScope) => Effect.Effect<A, ServiceError>,
) =>
  Effect.flatMap(resolveRequestedDraft(ctx, projectId), ({ scope, started }) => {
    if (!scope || !started) return run(scope);
    return Effect.onError(run(scope), () => dropIfEmpty(ctx.db, scope));
  });

/**
 * Runs a content write in the draft a request names on a project, like `inDraftScope`. Live is
 * read-only (ADR 0003): a request naming no draft fails.
 */
export const inDraft = <A>(
  ctx: DraftScopeContext,
  projectId: number,
  run: (draft: Draft) => Effect.Effect<A, ServiceError>,
) =>
  inDraftScope(ctx, projectId, (scope) =>
    scope ? run(scope) : Effect.fail(new LiveReadOnlyError()),
  );

/** Deletes a draft in one statement, only while it stores nothing. */
const dropIfEmpty = (db: ServiceContext["db"], scope: Draft) =>
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
  return scopeOf(draft);
});

/** Promise form of `resolveDraftScope`, rejecting with the matching `ORPCError`. */
export function requireDraftScope(ctx: DraftScopeContext, projectId: number): Promise<DraftScope> {
  return runService(resolveDraftScope(ctx, projectId));
}
