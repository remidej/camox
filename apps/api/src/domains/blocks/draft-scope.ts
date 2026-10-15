import { and, eq, isNull, or } from "drizzle-orm";
import { Effect } from "effect";

import type { ServiceError } from "../../lib/errors";
import { runService } from "../../lib/run-service";
import { blocks, environments, pages, projects } from "../../schema";
import type { ServiceContext } from "../_shared/service-context";
import type { DraftScope } from "../drafts/scope";
import { resolveDraftScope } from "../drafts/service";

// A request naming a draft (`x-camox-draft`) reads and writes blocks in it once the project is
// known. These find the project from what a procedure is given, then check the draft with
// `resolveDraftScope`. When the project can't be found the request reads Live, where the
// procedure's own lookup fails with 404.

type ScopeContext = Pick<ServiceContext, "db" | "user" | "draft">;

/** The draft scope of a request on a project, or Live when there is no such project. */
const scopeOn = (ctx: ScopeContext, projectId: number | undefined) =>
  projectId === undefined ? Effect.succeed(null) : resolveDraftScope(ctx, projectId);

/**
 * The draft scope of a request on a block. The block's project comes from its Live row or the
 * named draft's row, so a block the draft created is found too.
 */
export const draftScopeOfBlock = Effect.fn("blocks.draftScopeOfBlock")(function* (
  ctx: ScopeContext,
  blockId: string,
) {
  const draft = ctx.draft;
  if (!draft) return null;
  const row = yield* Effect.promise(() =>
    ctx.db
      .select({ projectId: environments.projectId })
      .from(blocks)
      .innerJoin(environments, eq(environments.id, blocks.environmentId))
      .where(and(eq(blocks.id, blockId), or(isNull(blocks.draftId), eq(blocks.draftId, draft.id))))
      .get(),
  );
  return yield* scopeOn(ctx, row?.projectId);
});

/** The draft scope of a request on a page's blocks. */
export const draftScopeOfPage = Effect.fn("blocks.draftScopeOfPage")(function* (
  ctx: ScopeContext,
  pageId: string,
) {
  if (!ctx.draft) return null;
  const page = yield* Effect.promise(() =>
    ctx.db.select({ projectId: pages.projectId }).from(pages).where(eq(pages.id, pageId)).get(),
  );
  return yield* scopeOn(ctx, page?.projectId);
});

/** The draft scope of a request on a project named by its slug. */
export const draftScopeOfProjectSlug = Effect.fn("blocks.draftScopeOfProjectSlug")(function* (
  ctx: ScopeContext,
  projectSlug: string,
) {
  if (!ctx.draft) return null;
  const project = yield* Effect.promise(() =>
    ctx.db.select({ id: projects.id }).from(projects).where(eq(projects.slug, projectSlug)).get(),
  );
  return yield* scopeOn(ctx, project?.id);
});

/** The draft scope of a request on a project. */
export const draftScopeOfProject = (ctx: ScopeContext, projectId: number) =>
  resolveDraftScope(ctx, projectId);

/** Runs a service in the draft scope a request resolves to, at a procedure's Promise boundary. */
export function inScope<A>(
  scope: Effect.Effect<DraftScope, ServiceError>,
  run: (scope: DraftScope) => Effect.Effect<A, ServiceError>,
) {
  return runService(Effect.flatMap(scope, run));
}
