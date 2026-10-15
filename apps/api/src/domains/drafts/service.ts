import { and, eq, not } from "drizzle-orm";
import { Effect } from "effect";

import { getAuthorizedProject, requireUser } from "../../authorization";
import { ForbiddenError, NotFoundError, type ServiceError } from "../../lib/errors";
import { runService } from "../../lib/run-service";
import type { ServiceContext } from "../_shared/service-context";
import * as overlay from "./overlay";
import { drafts } from "./schema";
import type { DraftScope } from "./scope";

type DraftScopeContext = Pick<ServiceContext, "db" | "user" | "draft">;

const scopeOf = (draft: typeof drafts.$inferSelect) =>
  ({ id: draft.id, kind: draft.kind, projectId: draft.projectId }) satisfies DraftScope;

/**
 * Turn the draft a request names (`ctx.draft`) into the scope a service reads and writes, once
 * the service knows the project. No draft means Live, which is public. Naming a draft needs a
 * member of the project's organization: anonymous callers fail with 401, outsiders with 403. A
 * missing draft is created with the caller as creator when the request sends the create header
 * (`started`), and fails with 404 otherwise, as does a draft of another project.
 */
const resolveRequestedDraft = Effect.fn("resolveRequestedDraft")(function* (
  ctx: DraftScopeContext,
  projectId: number,
): Effect.fn.Return<{ scope: DraftScope; started: boolean }, ServiceError> {
  const requested = ctx.draft;
  if (!requested) return { scope: null, started: false };
  const user = yield* requireUser(ctx);
  yield* getAuthorizedProject(ctx.db, projectId, user.id);

  let started = false;
  if (requested.create) {
    // Two requests racing to start the same draft both land here; the primary key keeps one.
    const inserted = yield* Effect.promise(() =>
      ctx.db
        .insert(drafts)
        .values({
          id: requested.id,
          projectId,
          kind: "regular",
          createdBy: user.id,
          createdAt: Date.now(),
        })
        .onConflictDoNothing({ target: drafts.id })
        .returning({ id: drafts.id })
        .get(),
    );
    started = inserted !== undefined;
  }

  const draft = yield* Effect.promise(() =>
    ctx.db.select().from(drafts).where(eq(drafts.id, requested.id)).get(),
  );
  if (draft?.projectId !== projectId) {
    return yield* new NotFoundError({ message: `Draft ${requested.id} not found in this project` });
  }

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

/** Deletes a draft in one statement, only while it stores nothing. */
const dropIfEmpty = (db: ServiceContext["db"], scope: NonNullable<DraftScope>) =>
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
