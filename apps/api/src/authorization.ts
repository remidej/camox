import { and, eq, or } from "drizzle-orm";
import { Effect } from "effect";

import type { Database } from "./db";
import { ForbiddenError, NotFoundError, UnauthenticatedError } from "./lib/errors";
import { member, blocks, files, layouts, pages, projects, repeatableItems } from "./schema";

// --- Definition Sync ---

type SyncPrincipal = {
  user: { id: string; email: string } | null;
  environmentName: string;
  deployToken?: string;
};

/**
 * Authorize code-definition writes.
 *
 * Humans may only sync their own email-based development environment. The
 * project deploy token is deliberately restricted to production releases.
 */
export const assertSyncAccess = Effect.fn("assertSyncAccess")(function* (
  db: Database,
  projectSlug: string,
  principal: SyncPrincipal,
) {
  const project = yield* Effect.promise(() =>
    db.select().from(projects).where(eq(projects.slug, projectSlug)).get(),
  );
  if (!project) return yield* new NotFoundError();

  if (principal.deployToken) {
    if (principal.environmentName !== "production") {
      return yield* new ForbiddenError({
        message: "Deploy tokens may only sync the production environment",
      });
    }

    if (principal.deployToken !== project.deployToken) {
      return yield* new UnauthenticatedError();
    }

    return project;
  }

  if (!principal.user) {
    return yield* new UnauthenticatedError();
  }

  const expectedEnvironment = `dev:${principal.user.email}`;
  if (principal.environmentName !== expectedEnvironment) {
    return yield* new ForbiddenError({
      message: `Authenticated sync is restricted to ${expectedEnvironment}`,
    });
  }

  yield* assertProjectMembership(db, project.id, principal.user.id);

  return project;
});

// --- Session Helpers ---

/** Narrow a nullable session user, failing when the caller is anonymous. */
export function requireUser<U>(ctx: { user: U | null }) {
  if (!ctx.user) return Effect.fail(new UnauthenticatedError());
  return Effect.succeed(ctx.user);
}

// --- Membership Helpers ---

/** Verify user is a member of the org that owns a project (by project ID). */
const assertProjectMembership = Effect.fn("assertProjectMembership")(function* (
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
  if (!result) return yield* new ForbiddenError();
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

export const getAuthorizedProjectBySlug = Effect.fn("getAuthorizedProjectBySlug")(function* (
  db: Database,
  slug: string,
  userId: string,
) {
  const project = yield* Effect.promise(() =>
    db.select().from(projects).where(eq(projects.slug, slug)).get(),
  );
  if (!project) return yield* new NotFoundError();
  yield* assertProjectMembership(db, project.id, userId);
  return project;
});

export const assertPageAccess = Effect.fn("assertPageAccess")(function* (
  db: Database,
  pageId: number,
  userId: string,
) {
  const result = yield* Effect.promise(() =>
    db
      .select({ page: pages, projectId: projects.id })
      .from(pages)
      .innerJoin(projects, eq(projects.id, pages.projectId))
      .where(eq(pages.id, pageId))
      .get(),
  );
  if (!result) return yield* new NotFoundError();
  yield* assertProjectMembership(db, result.projectId, userId);
  return result;
});

export const assertLayoutAccess = Effect.fn("assertLayoutAccess")(function* (
  db: Database,
  layoutId: number,
  userId: string,
) {
  const result = yield* Effect.promise(() =>
    db
      .select({ layout: layouts, projectId: projects.id })
      .from(layouts)
      .innerJoin(projects, eq(projects.id, layouts.projectId))
      .where(eq(layouts.id, layoutId))
      .get(),
  );
  if (!result) return yield* new NotFoundError();
  yield* assertProjectMembership(db, result.projectId, userId);
  return result;
});

export const assertBlockAccess = Effect.fn("assertBlockAccess")(function* (
  db: Database,
  blockId: number,
  userId: string,
) {
  const result = yield* Effect.promise(() =>
    db
      .select({ block: blocks, projectId: projects.id, pagePath: pages.fullPath })
      .from(blocks)
      .leftJoin(pages, eq(blocks.pageId, pages.id))
      .leftJoin(layouts, eq(blocks.layoutId, layouts.id))
      .innerJoin(projects, or(eq(projects.id, pages.projectId), eq(projects.id, layouts.projectId)))
      .where(eq(blocks.id, blockId))
      .get(),
  );
  if (!result) return yield* new NotFoundError();
  yield* assertProjectMembership(db, result.projectId, userId);
  return result;
});

export const assertRepeatableItemAccess = Effect.fn("assertRepeatableItemAccess")(function* (
  db: Database,
  itemId: number,
  userId: string,
) {
  const result = yield* Effect.promise(() =>
    db
      .select({ item: repeatableItems, projectId: projects.id, pagePath: pages.fullPath })
      .from(repeatableItems)
      .innerJoin(blocks, eq(repeatableItems.blockId, blocks.id))
      .leftJoin(pages, eq(blocks.pageId, pages.id))
      .leftJoin(layouts, eq(blocks.layoutId, layouts.id))
      .innerJoin(projects, or(eq(projects.id, pages.projectId), eq(projects.id, layouts.projectId)))
      .where(eq(repeatableItems.id, itemId))
      .get(),
  );
  if (!result) return yield* new NotFoundError();
  yield* assertProjectMembership(db, result.projectId, userId);
  return result;
});

export const assertFileAccess = Effect.fn("assertFileAccess")(function* (
  db: Database,
  fileId: number,
  userId: string,
) {
  const result = yield* Effect.promise(() =>
    db
      .select({ file: files })
      .from(files)
      .innerJoin(projects, eq(projects.id, files.projectId))
      .where(eq(files.id, fileId))
      .get(),
  );
  if (!result) return yield* new NotFoundError();
  yield* assertProjectMembership(db, result.file.projectId!, userId);
  return result;
});
