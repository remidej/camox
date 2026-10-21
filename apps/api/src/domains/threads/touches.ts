import type { Touch, TouchKind } from "@camox/api-contract/threads";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { z } from "zod";

import type { Database } from "../../db";
import { drafts } from "../../schema";
import { findSharedContent } from "../blocks/shared-content";
import { draftOf } from "../drafts/scope";

/** A block a write returned: where it's placed, and what it places. */
const writtenBlockSchema = z.object({
  id: z.string(),
  pageId: z.string().nullable(),
  layoutId: z.string().nullable(),
  type: z.string(),
  locale: z.string(),
});

const pageSchema = z.object({ id: z.string(), locale: z.string() });

/** A page a write returned: as is, or under `page`, as `createPage` returns it. */
const writtenPageSchema = z.union([
  pageSchema,
  z.object({ page: pageSchema }).transform(({ page }) => page),
]);

/** One successful write of the studio agent's tools, in the draft it landed in. */
export type Write = {
  projectId: number;
  draftId: string;
  name: string;
  args: unknown;
  result: unknown;
};

/** Where a block is placed, as a touch names it: its page, or its layout. */
const blockTouch = (block: z.infer<typeof writtenBlockSchema>, kind: TouchKind): Touch[] => {
  const { id: blockId, locale } = block;
  if (block.pageId) return [{ entity: "page", pageId: block.pageId, blockId, kind, locale }];
  if (block.layoutId)
    return [{ entity: "layout", layoutId: block.layoutId, blockId, kind, locale }];
  return [];
};

/** The tools whose writes are on the Canvas, by name: what they write, and how it's touched. */
const TOUCHING_TOOLS: Record<string, { writes: "block" | "page"; kind: TouchKind }> = {
  createBlock: { writes: "block", kind: "created" },
  editBlock: { writes: "block", kind: "edited" },
  moveBlock: { writes: "block", kind: "moved" },
  deleteBlock: { writes: "block", kind: "deleted" },
  createPage: { writes: "page", kind: "created" },
  updatePage: { writes: "page", kind: "settings" },
  setPageLayout: { writes: "page", kind: "settings" },
  setPageSeo: { writes: "page", kind: "settings" },
  deletePage: { writes: "page", kind: "deleted" },
};

/**
 * What a write touched, so the studio can follow it: the Page and Block, Layout and Block, or
 * Synced Block's shared content it changed. Writes to Collection Records, Files and Locales aren't
 * on the Canvas, so they touch nothing here.
 */
export const touchesOf = Effect.fn("threads.touchesOf")(function* (db: Database, write: Write) {
  const tool = TOUCHING_TOOLS[write.name];
  if (!tool) return [];
  if (tool.writes === "page") {
    const page = writtenPageSchema.safeParse(write.result);
    if (!page.success) return [];
    const { id: pageId, locale } = page.data;
    return [{ entity: "page", pageId, kind: tool.kind, locale }] satisfies Touch[];
  }
  const block = writtenBlockSchema.safeParse(write.result);
  if (!block.success) return [];
  // A synced placement's content and settings are its definition's shared content.
  if (tool.kind === "edited" && (yield* isSynced(db, write, block.data.type))) {
    const { type: blockType, locale } = block.data;
    return [{ entity: "synced-block", blockType, kind: "edited", locale }] satisfies Touch[];
  }
  return blockTouch(block.data, tool.kind);
});

/** Whether a block definition is synced in the write's draft: while its shared content exists. */
const isSynced = Effect.fn("threads.isSynced")(function* (
  db: Database,
  { projectId, draftId }: Write,
  type: string,
) {
  const draft = yield* Effect.promise(() =>
    db.select().from(drafts).where(eq(drafts.id, draftId)).get(),
  );
  if (!draft) return false;
  const key = { projectId, type };
  const shared = yield* findSharedContent(db, draftOf(draft), key);
  return shared !== undefined;
});
