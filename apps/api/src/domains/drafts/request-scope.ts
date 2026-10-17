import { and, eq, sql } from "drizzle-orm";
import { Effect } from "effect";

import { NotFoundError, type ServiceError } from "../../lib/errors";
import { runService } from "../../lib/run-service";
import { blocks, files, pages, projects, repeatableItems } from "../../schema";
import type { ServiceContext } from "../_shared/service-context";
import type { Draft, DraftScope } from "./scope";
import { inDraft, inDraftScope, storedForRequest } from "./service";

// A request naming a draft (`x-camox-draft`) reads and writes content in it once the project is
// known. These find the project from what a procedure is given; `inScope` then checks the draft
// and runs the service in it. When the project can't be found the request reads Live, where the
// procedure's own lookup fails with 404. Without a draft no lookup runs.

type ScopeContext = Pick<ServiceContext, "db" | "user" | "draft">;

type ProjectLookup = Effect.Effect<number | undefined>;

/** Runs `find` only for a request naming a draft: without one the request reads Live. */
const lookupProject = (
  ctx: ScopeContext,
  find: () => Promise<{ projectId: number | null } | undefined>,
): ProjectLookup =>
  ctx.draft
    ? Effect.map(Effect.promise(find), (row) => row?.projectId ?? undefined)
    : Effect.succeed(undefined);

/**
 * The project of a block, page or file. Its Live row or the named draft's row is found, so an
 * entity the draft created is found too.
 */
const projectOfStored = (
  ctx: ScopeContext,
  table: typeof blocks | typeof pages | typeof files,
  id: string,
) =>
  lookupProject(ctx, () =>
    ctx.db
      .select({ projectId: table.projectId })
      .from(table)
      .where(and(eq(table.id, id), storedForRequest(table, ctx)))
      .get(),
  );

export const projectOfBlock = (ctx: ScopeContext, blockId: string) =>
  projectOfStored(ctx, blocks, blockId);

export const projectOfPage = (ctx: ScopeContext, pageId: string) =>
  projectOfStored(ctx, pages, pageId);

export const projectOfFile = (ctx: ScopeContext, fileId: string) =>
  projectOfStored(ctx, files, fileId);

/** The project of a repeatable item, through the block or shared content at its root. */
export const projectOfItem = (ctx: ScopeContext, itemId: string) =>
  lookupProject(ctx, () =>
    ctx.db
      .select({
        projectId: sql<number | null>`coalesce(${blocks.projectId}, ${repeatableItems.projectId})`,
      })
      .from(repeatableItems)
      .leftJoin(blocks, and(eq(blocks.id, repeatableItems.blockId), storedForRequest(blocks, ctx)))
      .where(and(eq(repeatableItems.id, itemId), storedForRequest(repeatableItems, ctx)))
      .get(),
  );

/** The project named by a slug. */
export const projectOfSlug = (ctx: ScopeContext, projectSlug: string) =>
  lookupProject(ctx, () =>
    ctx.db
      .select({ projectId: projects.id })
      .from(projects)
      .where(eq(projects.slug, projectSlug))
      .get(),
  );

/**
 * Runs a service, at a procedure's Promise boundary, in the draft scope the request names on the
 * project `project` finds (Live when it finds none).
 */
export function inScope<A>(
  ctx: ScopeContext,
  project: ProjectLookup | number,
  run: (scope: DraftScope) => Effect.Effect<A, ServiceError>,
) {
  const lookup = typeof project === "number" ? Effect.succeed(project) : project;
  return runService(
    Effect.flatMap(lookup, (projectId) =>
      projectId === undefined ? run(null) : inDraftScope(ctx, projectId, run),
    ),
  );
}

/**
 * Runs a content write, at a procedure's Promise boundary, in the draft the request names on the
 * project `project` finds. Fails closed: 404 when it finds no project, and Live is read-only.
 */
export function inWriteDraft<A>(
  ctx: ScopeContext,
  project: ProjectLookup | number,
  run: (draft: Draft) => Effect.Effect<A, ServiceError>,
) {
  const lookup = typeof project === "number" ? Effect.succeed(project) : project;
  return runService(
    Effect.flatMap(lookup, (projectId) =>
      projectId === undefined ? Effect.fail(new NotFoundError()) : inDraft(ctx, projectId, run),
    ),
  );
}
