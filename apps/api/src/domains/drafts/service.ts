import { eq } from "drizzle-orm";
import { Effect } from "effect";

import { getAuthorizedProject, requireUser } from "../../authorization";
import { ForbiddenError, NotFoundError } from "../../lib/errors";
import { runService } from "../../lib/run-service";
import type { ServiceContext } from "../_shared/service-context";
import { drafts } from "./schema";
import type { DraftScope } from "./scope";

type DraftScopeContext = Pick<ServiceContext, "db" | "user" | "draft">;

/**
 * Turn the draft a request names (`ctx.draft`) into the scope a service reads and writes, once
 * the service knows the project. No draft means Live, which is public. Naming a draft needs a
 * member of the project's organization: anonymous callers fail with 401, outsiders with 403. A
 * missing draft is created with the caller as creator when the request sends the create header,
 * and fails with 404 otherwise, as does a draft of another project.
 */
export const resolveDraftScope = Effect.fn("resolveDraftScope")(function* (
  ctx: DraftScopeContext,
  projectId: number,
) {
  const requested = ctx.draft;
  if (!requested) return null satisfies DraftScope;
  const user = yield* requireUser(ctx);
  yield* getAuthorizedProject(ctx.db, projectId, user.id);

  if (requested.create) {
    // Two requests racing to start the same draft both land here; the primary key keeps one.
    yield* Effect.promise(() =>
      ctx.db
        .insert(drafts)
        .values({
          id: requested.id,
          projectId,
          kind: "regular",
          createdBy: user.id,
          createdAt: Date.now(),
        })
        .onConflictDoNothing({ target: drafts.id }),
    );
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

  return { id: draft.id, kind: draft.kind, projectId: draft.projectId } satisfies DraftScope;
});

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
  return { id: draft.id, kind: draft.kind, projectId: draft.projectId } satisfies DraftScope;
});

/** Promise form of `resolveDraftScope`, rejecting with the matching `ORPCError`. */
export function requireDraftScope(ctx: DraftScopeContext, projectId: number): Promise<DraftScope> {
  return runService(resolveDraftScope(ctx, projectId));
}
