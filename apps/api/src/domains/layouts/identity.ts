import { and, eq } from "drizzle-orm";

import { blocks } from "../blocks/schema";
import { pages } from "../pages/schema";
import { layouts } from "./schema";

// A layout is identified by its name within a project (ADR 0004).
// Pages and blocks point at it by that name.

/** The layout with this name in a project. */
export function layoutNamed(projectId: number, layoutId: string) {
  return and(eq(layouts.projectId, projectId), eq(layouts.layoutId, layoutId));
}

/** The blocks in a layout's slots. */
export function blocksOfLayout(layout: { projectId: number; layoutId: string }) {
  return and(eq(blocks.projectId, layout.projectId), eq(blocks.layoutId, layout.layoutId));
}

/** The blocks sharing a block's owner: its page, or its layout. Null when it has neither. */
export function blocksOfOwner(block: {
  projectId: number;
  pageId: string | null;
  layoutId: string | null;
}) {
  if (block.pageId != null) return eq(blocks.pageId, block.pageId);
  if (block.layoutId != null)
    return blocksOfLayout({ projectId: block.projectId, layoutId: block.layoutId });
  return null;
}

/** Join condition from a block to the layout whose slot holds it. */
export const layoutOfBlock = and(
  eq(layouts.projectId, blocks.projectId),
  eq(layouts.layoutId, blocks.layoutId),
);

/** Join condition from a page to its layout. */
export const layoutOfPage = and(
  eq(layouts.projectId, pages.projectId),
  eq(layouts.layoutId, pages.layoutId),
);
