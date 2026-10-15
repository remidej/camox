import { eq, inArray } from "drizzle-orm";
import { Effect } from "effect";

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
