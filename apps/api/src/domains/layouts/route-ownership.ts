import { and, eq } from "drizzle-orm";
import { Effect } from "effect";

import { ConflictError, InvalidInputError, NotFoundError } from "../../lib/errors";
import { layouts } from "../../schema";
import { definitionsIn } from "../_shared/definitions";
import type { ServiceContext } from "../_shared/service-context";
import type { ReadScope } from "../drafts/scope";

export function singletonPath(layoutId: string) {
  if (!/^[\w-]+(?:\.[\w-]+)*$/.test(layoutId))
    return Effect.fail(
      new InvalidInputError({
        message: `Singleton layouts require a fixed file route: ${layoutId}`,
      }),
    );
  return Effect.succeed(`/${layoutId.split(".").join("/")}`);
}

export function normalizePagePath(path: string) {
  try {
    return Effect.succeed(`/${path.split("/").filter(Boolean).map(decodeURIComponent).join("/")}`);
  } catch {
    return Effect.fail(new InvalidInputError({ message: "Invalid page URL encoding" }));
  }
}

export const assertCuratedLayout = Effect.fn("layouts.assertCuratedLayout")(function* (
  ctx: ServiceContext,
  projectId: number,
  layoutId: string,
  scope: ReadScope,
) {
  const layout = yield* Effect.promise(() =>
    ctx.db
      .select()
      .from(layouts)
      .where(
        and(
          eq(layouts.layoutId, layoutId),
          eq(layouts.projectId, projectId),
          definitionsIn(layouts, scope),
        ),
      )
      .get(),
  );
  if (!layout) return yield* new NotFoundError({ message: "Layout not found in this project" });
  if (layout.kind !== "curated")
    return yield* new InvalidInputError({
      message: "Only curated layouts can be assigned to pages",
    });
});

export const assertUnreservedPagePaths = Effect.fn("layouts.assertUnreservedPagePaths")(function* (
  ctx: ServiceContext,
  projectId: number,
  paths: string[],
  scope: ReadScope,
) {
  const singletons = yield* Effect.promise(() =>
    ctx.db
      .select()
      .from(layouts)
      .where(
        and(
          eq(layouts.projectId, projectId),
          definitionsIn(layouts, scope),
          eq(layouts.kind, "singleton"),
        ),
      ),
  );
  const reserved = new Set<string>();
  for (const layout of singletons) reserved.add(yield* singletonPath(layout.layoutId));
  for (const path of paths) {
    if (reserved.has(yield* normalizePagePath(path)))
      return yield* new ConflictError({ message: `URL ${path} is owned by a singleton page` });
  }
});

/**
 * Pages are served only through a curated layout. A page whose layout was removed (no layout
 * of that name) or is no longer curated needs a layout.
 */
export function servesPages(layout: { kind: string } | null | undefined) {
  return layout?.kind === "curated";
}

/**
 * For each curated page, whether it can't be served: its layout was removed or is no longer
 * curated (it needs a layout), or a singleton serves its URL instead (it's shadowed).
 */
export const pageServingProblems = Effect.fn("layouts.pageServingProblems")(function* (
  ctx: ServiceContext,
  projectId: number,
  scope: ReadScope,
) {
  const rows = yield* Effect.promise(() =>
    ctx.db
      .select()
      .from(layouts)
      .where(and(eq(layouts.projectId, projectId), definitionsIn(layouts, scope))),
  );
  const byName = new Map(rows.map((layout) => [layout.layoutId, layout]));
  const pathOf = (path: Effect.Effect<string, InvalidInputError>) =>
    Effect.runSync(Effect.orElseSucceed(path, () => null));
  const singletonPaths = new Set<string | null>(
    rows
      .filter((layout) => layout.kind === "singleton")
      .map((layout) => pathOf(singletonPath(layout.layoutId))),
  );
  singletonPaths.delete(null);
  return (page: { layoutId: string; fullPath: string }) => ({
    needsLayout: !servesPages(byName.get(page.layoutId)),
    shadowed: singletonPaths.has(pathOf(normalizePagePath(page.fullPath))),
  });
});
