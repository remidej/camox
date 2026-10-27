import { DRAFT_HEADER } from "@camox/api-contract/drafts";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";

import type { Database } from "./db";
import {
  RELEASE,
  type DraftRequest,
  type DraftScope,
  type WriteTarget,
} from "./domains/drafts/scope";
import { projectNamed, type ProjectRef } from "./domains/projects/ref";
import {
  ForbiddenError,
  NotFoundError,
  type ServiceError,
  UnauthenticatedError,
} from "./lib/errors";
import { record } from "./lib/journal";
import { member, projects } from "./schema";

// --- Definition Sync ---

/** Where a definition sync writes: Live for a release, or a draft with code's own definitions. */
export type SyncTarget = {
  project: typeof projects.$inferSelect;
  scope: DraftScope;
  /** Where the sync writes content: Live as a release, or the draft. */
  writes: WriteTarget;
};

/** Records that a sync changed the definitions of its target, which all its content conforms to. */
export const recordDefinitionsSynced = (
  db: Database,
  { project, scope }: Pick<SyncTarget, "project" | "scope">,
) => record(db, { kind: "definitions", projectId: project.id, draftId: scope?.id ?? null });

/**
 * Authorize a release's definition writes (ADR 0006): with the project's deploy token and no
 * draft, a sync writes Live.
 */
export const assertSyncAccess = Effect.fn("assertSyncAccess")(function* (
  db: Database,
  ref: ProjectRef,
  principal: { draft: DraftRequest | null; deployToken: string },
): Effect.fn.Return<SyncTarget, ServiceError> {
  const project = yield* Effect.promise(() =>
    db.select().from(projects).where(projectNamed(ref)).get(),
  );
  if (!project) return yield* new NotFoundError();
  if (principal.draft) {
    return yield* new ForbiddenError({
      message: `A release writes Live: deploy tokens can't name a draft with ${DRAFT_HEADER}`,
    });
  }
  if (principal.deployToken !== project.deployToken) return yield* new UnauthenticatedError();
  return { project, scope: null, writes: RELEASE };
});

// --- Session Helpers ---

/** Narrow a nullable session user, failing when the caller is anonymous. */
export function requireUser<U>(ctx: { user: U | null }) {
  if (!ctx.user) return Effect.fail(new UnauthenticatedError());
  return Effect.succeed(ctx.user);
}

// --- Membership Helpers ---

/** Whether a user is a member of the org that owns a project (by project ID). */
export const isProjectMember = Effect.fn("isProjectMember")(function* (
  db: Database,
  projectId: number,
  userId: string,
) {
  const result = yield* Effect.promise(() =>
    db
      .select({ id: member.id })
      .from(projects)
      .innerJoin(
        member,
        and(eq(member.organizationId, projects.organizationId), eq(member.userId, userId)),
      )
      .where(eq(projects.id, projectId))
      .get(),
  );
  return result != null;
});

/** Verify user is a member of the org that owns a project (by project ID). */
const assertProjectMembership = Effect.fn("assertProjectMembership")(function* (
  db: Database,
  projectId: number,
  userId: string,
) {
  if (!(yield* isProjectMember(db, projectId, userId))) return yield* new ForbiddenError();
});

export const assertOrgMembership = Effect.fn("assertOrgMembership")(function* (
  db: Database,
  userId: string,
  orgId: string,
) {
  const result = yield* Effect.promise(() =>
    db
      .select({ id: member.id })
      .from(member)
      .where(and(eq(member.organizationId, orgId), eq(member.userId, userId)))
      .get(),
  );
  if (!result) return yield* new ForbiddenError();
});

// --- Authorization Helpers ---
//
// Each helper fails with `NotFoundError` when the row doesn't exist and
// `ForbiddenError` when it exists but the user isn't a member of its project.

export const getAuthorizedProject = Effect.fn("getAuthorizedProject")(function* (
  db: Database,
  projectId: number,
  userId: string,
) {
  const project = yield* Effect.promise(() =>
    db.select().from(projects).where(eq(projects.id, projectId)).get(),
  );
  if (!project) return yield* new NotFoundError();
  yield* assertProjectMembership(db, projectId, userId);
  return project;
});
