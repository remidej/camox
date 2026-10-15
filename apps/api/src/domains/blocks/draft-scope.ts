import { and, eq } from "drizzle-orm";
import { Effect } from "effect";

import type { ServiceError } from "../../lib/errors";
import { runService } from "../../lib/run-service";
import { blocks, environments, pages, projects } from "../../schema";
import type { ServiceContext } from "../_shared/service-context";
import * as overlay from "../drafts/overlay";
import type { DraftScope } from "../drafts/scope";
import { inDraftScope } from "../drafts/service";

// A request naming a draft (`x-camox-draft`) reads and writes blocks in it once the project is
// known. These find the project from what a procedure is given; `inScope` then checks the draft
// and runs the service in it. When the project can't be found the request reads Live, where the
// procedure's own lookup fails with 404. Without a draft no lookup runs.

type ScopeContext = Pick<ServiceContext, "db" | "user" | "draft">;

type ProjectLookup = Effect.Effect<number | undefined>;

/**
 * The project of a block. Its Live row or the named draft's row is found, so a block the draft
 * created is found too.
 */
export const projectOfBlock = Effect.fn("blocks.projectOfBlock")(function* (
  ctx: ScopeContext,
  blockId: string,
) {
  const draft = ctx.draft;
  if (!draft) return undefined;
  const row = yield* Effect.promise(() =>
    ctx.db
      .select({ projectId: environments.projectId })
      .from(blocks)
      .innerJoin(environments, eq(environments.id, blocks.environmentId))
      .where(and(eq(blocks.id, blockId), overlay.storedInLiveOrDraft(blocks, draft.id)))
      .get(),
  );
  return row?.projectId;
});

/** The project of a page. */
export const projectOfPage = Effect.fn("blocks.projectOfPage")(function* (
  ctx: ScopeContext,
  pageId: string,
) {
  if (!ctx.draft) return undefined;
  const page = yield* Effect.promise(() =>
    ctx.db.select({ projectId: pages.projectId }).from(pages).where(eq(pages.id, pageId)).get(),
  );
  return page?.projectId;
});

/** The project named by a slug. */
export const projectOfSlug = Effect.fn("blocks.projectOfSlug")(function* (
  ctx: ScopeContext,
  projectSlug: string,
) {
  if (!ctx.draft) return undefined;
  const project = yield* Effect.promise(() =>
    ctx.db.select({ id: projects.id }).from(projects).where(eq(projects.slug, projectSlug)).get(),
  );
  return project?.id;
});

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
