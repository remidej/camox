import { and, eq } from "drizzle-orm";
import { Effect } from "effect";

import { ConflictError, InvalidInputError, NotFoundError } from "../../lib/errors";
import { layouts } from "../../schema";
import type { ServiceContext } from "../_shared/service-context";

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
  environmentId: number,
  layoutId: number,
) {
  const layout = yield* Effect.promise(() =>
    ctx.db
      .select()
      .from(layouts)
      .where(and(eq(layouts.id, layoutId), eq(layouts.environmentId, environmentId)))
      .get(),
  );
  if (!layout) return yield* new NotFoundError({ message: "Layout not found in this environment" });
  if (layout.kind !== "curated")
    return yield* new InvalidInputError({
      message: "Only curated layouts can be assigned to pages",
    });
});

export const assertUnreservedPagePaths = Effect.fn("layouts.assertUnreservedPagePaths")(function* (
  ctx: ServiceContext,
  environmentId: number,
  paths: string[],
) {
  const singletons = yield* Effect.promise(() =>
    ctx.db
      .select()
      .from(layouts)
      .where(and(eq(layouts.environmentId, environmentId), eq(layouts.kind, "singleton"))),
  );
  const reserved = new Set<string>();
  for (const layout of singletons) reserved.add(yield* singletonPath(layout.layoutId));
  for (const path of paths) {
    if (reserved.has(yield* normalizePagePath(path)))
      return yield* new ConflictError({ message: `URL ${path} is owned by a singleton page` });
  }
});
