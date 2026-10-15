import { and, eq } from "drizzle-orm";

import { blocks } from "../blocks/schema";
import { pages } from "../pages/schema";
import { layouts } from "./schema";

// A layout is identified by its name within a project's environment (ADR 0004).
// Pages and blocks point at it by that name.

/** The layout with this name in an environment. */
export function layoutNamed(environmentId: number, layoutId: string) {
  return and(eq(layouts.environmentId, environmentId), eq(layouts.layoutId, layoutId));
}

/** The blocks in a layout's slots. */
export function blocksOfLayout(layout: { environmentId: number; layoutId: string }) {
  return and(eq(blocks.environmentId, layout.environmentId), eq(blocks.layoutId, layout.layoutId));
}

/** The blocks sharing a block's owner: its page, or its layout. Null when it has neither. */
export function blocksOfOwner(block: {
  environmentId: number;
  pageId: number | null;
  layoutId: string | null;
}) {
  if (block.pageId != null) return eq(blocks.pageId, block.pageId);
  if (block.layoutId != null)
    return blocksOfLayout({ environmentId: block.environmentId, layoutId: block.layoutId });
  return null;
}

/** Join condition from a block to the layout whose slot holds it. */
export const layoutOfBlock = and(
  eq(layouts.environmentId, blocks.environmentId),
  eq(layouts.layoutId, blocks.layoutId),
);

/** Join condition from a page to its layout. */
export const layoutOfPage = and(
  eq(layouts.environmentId, pages.environmentId),
  eq(layouts.layoutId, pages.layoutId),
);
