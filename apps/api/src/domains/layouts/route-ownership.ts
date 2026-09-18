import { ORPCError } from "@orpc/server";
import { and, eq } from "drizzle-orm";

import { layouts } from "../../schema";
import type { ServiceContext } from "../_shared/service-context";

export function singletonPath(layoutId: string) {
  if (!/^[\w-]+(?:\.[\w-]+)*$/.test(layoutId))
    throw new ORPCError("BAD_REQUEST", {
      message: `Singleton layouts require a fixed file route: ${layoutId}`,
    });
  return `/${layoutId.split(".").join("/")}`;
}

export function normalizePagePath(path: string) {
  try {
    return `/${path.split("/").filter(Boolean).map(decodeURIComponent).join("/")}`;
  } catch {
    throw new ORPCError("BAD_REQUEST", { message: "Invalid page URL encoding" });
  }
}

export async function assertCuratedLayout(
  ctx: ServiceContext,
  environmentId: number,
  layoutId: number,
) {
  const layout = await ctx.db
    .select()
    .from(layouts)
    .where(and(eq(layouts.id, layoutId), eq(layouts.environmentId, environmentId)))
    .get();
  if (!layout)
    throw new ORPCError("NOT_FOUND", { message: "Layout not found in this environment" });
  if (layout.kind !== "curated")
    throw new ORPCError("BAD_REQUEST", {
      message: "Only curated layouts can be assigned to pages",
    });
}

export async function assertUnreservedPagePaths(
  ctx: ServiceContext,
  environmentId: number,
  paths: string[],
) {
  const singletons = await ctx.db
    .select()
    .from(layouts)
    .where(and(eq(layouts.environmentId, environmentId), eq(layouts.kind, "singleton")));
  const reserved = new Set(singletons.map((layout) => singletonPath(layout.layoutId)));
  for (const path of paths) {
    if (reserved.has(normalizePagePath(path)))
      throw new ORPCError("CONFLICT", { message: `URL ${path} is owned by a singleton page` });
  }
}
