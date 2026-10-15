import { eq, inArray } from "drizzle-orm";
import { Effect } from "effect";

import { isProjectMember } from "../../authorization";
import { blocks, repeatableItems } from "../../schema";
import { blocksOfLayout } from "../layouts/identity";
import { sortByPosition } from "../pages/ai";
import type { ServiceContext } from "./service-context";

/** A page's or layout's current blocks, sorted, with every repeatable item they own. */
export const readOwnerBlocks = Effect.fn("readOwnerBlocks")(function* (
  ctx: ServiceContext,
  owner: { pageId: number } | { environmentId: number; layoutId: string },
) {
  const ownerBlocks = sortByPosition(
    yield* Effect.promise(() =>
      ctx.db
        .select()
        .from(blocks)
        .where("pageId" in owner ? eq(blocks.pageId, owner.pageId) : blocksOfLayout(owner)),
    ),
  );
  const blockIds = ownerBlocks.map((block) => block.id);
  const items =
    blockIds.length > 0
      ? sortByPosition(
          yield* Effect.promise(() =>
            ctx.db.select().from(repeatableItems).where(inArray(repeatableItems.blockId, blockIds)),
          ),
        )
      : [];
  return { blocks: ownerBlocks, items };
});

/**
 * Which version of a linked collection record a read resolves. Records still
 * publish on their own, so the project's members preview their saved drafts
 * and everyone else sees their published revision. Pages, layouts and blocks
 * read their current rows either way.
 */
export const referenceSource = Effect.fn("referenceSource")(function* (
  ctx: ServiceContext,
  projectId: number,
): Effect.fn.Return<"draft" | "live"> {
  if (!ctx.user) return "live";
  return (yield* isProjectMember(ctx.db, projectId, ctx.user.id)) ? "draft" : "live";
});
