import { DEVELOPMENT_DRAFT, DRAFT_HEADER } from "@camox/api-contract/drafts";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";

import type { Database } from "./db";
import { ensureDevelopmentDraft, findDevelopmentDraft } from "./domains/drafts/development";
import type { DraftRequest, DraftScope } from "./domains/drafts/scope";
import {
  ForbiddenError,
  NoDevelopmentDraftError,
  NotFoundError,
  type ServiceError,
  UnauthenticatedError,
} from "./lib/errors";
import { member, projects } from "./schema";

// --- Definition Sync ---

type SyncPrincipal = {
  user: { id: string; email: string } | null;
  draft: DraftRequest | null;
  deployToken?: string;
};

/** Where a definition sync writes: Live for a release, or a member's development draft. */
export type SyncTarget = {
  project: typeof projects.$inferSelect;
  scope: DraftScope;
  /** Whether this sync created the development draft. */
  draftCreated: boolean;
};

/**
 * Authorize code-definition writes and say where they go (ADR 0006). A release, with the
 * project's deploy token and no draft, writes Live. Dev mode, with a member's session and
 * `x-camox-draft: development`, writes the member's development draft, which a sync allowed to
 * `create` creates the first time.
 */
export const assertSyncAccess = Effect.fn("assertSyncAccess")(function* (
  db: Database,
  projectSlug: string,
  principal: SyncPrincipal,
  { create = false }: { create?: boolean } = {},
): Effect.fn.Return<SyncTarget, ServiceError> {
  const project = yield* Effect.promise(() =>
    db.select().from(projects).where(eq(projects.slug, projectSlug)).get(),
  );
  if (!project) return yield* new NotFoundError();

  if (principal.deployToken) {
    if (principal.draft) {
      return yield* new ForbiddenError({
        message: `A release writes Live: deploy tokens can't name a draft with ${DRAFT_HEADER}`,
      });
    }
    if (principal.deployToken !== project.deployToken) {
      return yield* new UnauthenticatedError();
    }
    return { project, scope: null, draftCreated: false };
  }

  if (!principal.user) {
    return yield* new UnauthenticatedError();
  }

  if (!principal.draft || !("development" in principal.draft)) {
    return yield* new ForbiddenError({
      message: `Dev-mode sync writes your development draft: send ${DRAFT_HEADER}: ${DEVELOPMENT_DRAFT}`,
    });
  }

  yield* assertProjectMembership(db, project.id, principal.user.id);

  const existing = yield* findDevelopmentDraft(db, project.id, principal.user.id);
  if (existing) return { project, scope: developmentScope(existing), draftCreated: false };
  if (!create) return yield* new NoDevelopmentDraftError();
  const { draft, created } = yield* ensureDevelopmentDraft(db, project.id, principal.user.id);
  return { project, scope: developmentScope(draft), draftCreated: created };
});

const developmentScope = (draft: { id: string; projectId: number }) =>
  ({ id: draft.id, kind: "development", projectId: draft.projectId }) satisfies DraftScope;

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
