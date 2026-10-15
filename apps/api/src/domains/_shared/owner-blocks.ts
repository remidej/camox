import { eq, inArray } from "drizzle-orm";
import { Effect } from "effect";

import { blocks, repeatableItems } from "../../schema";
import { withSharedContent } from "../blocks/shared-content";
import * as overlay from "../drafts/overlay";
import type { DraftScope } from "../drafts/scope";
import { blocksOfLayout } from "../layouts/identity";
import { sortItemsByPosition } from "../pages/ai";
import { conformBlocksIn } from "./conform-content";
import type { ServiceContext } from "./service-context";

/**
 * A page's or layout's current blocks as a scope reads them, sorted, with every repeatable item
 * they own, conformed to the block definitions in effect (ADR 0007). Synced placements show
 * their shared content.
 */
export const readOwnerBlocks = Effect.fn("readOwnerBlocks")(function* (
  ctx: ServiceContext,
  owner: { pageId: string } | { environmentId: number; layoutId: string },
  scope: DraftScope,
) {
  const ownerBlocks = overlay.sortByPosition(
    yield* overlay.select(
      ctx.db,
      scope,
      blocks,
      "pageId" in owner ? eq(blocks.pageId, owner.pageId) : blocksOfLayout(owner),
    ),
  );
  if (ownerBlocks.length === 0) return { blocks: [], items: [] };
  const blockIds = ownerBlocks.map((block) => block.id);
  const shown = yield* withSharedContent(
    ctx.db,
    scope,
    ownerBlocks,
    yield* overlay.select(
      ctx.db,
      scope,
      repeatableItems,
      inArray(repeatableItems.blockId, blockIds),
    ),
  );
  return yield* conformBlocksIn(
    ctx,
    ownerBlocks[0],
    scope,
    shown.blocks,
    sortItemsByPosition(shown.items),
  );
});
