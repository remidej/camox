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

/** A page a write returned. */
const writtenPageSchema = z.object({ id: z.string(), locale: z.string() });

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

const pageTouch = (result: unknown, kind: TouchKind): Touch[] => {
  const page = writtenPageSchema.safeParse(result);
  return page.success
    ? [{ entity: "page", pageId: page.data.id, kind, locale: page.data.locale }]
    : [];
};

/**
 * What a write touched, so the studio can follow it: the Page and Block, Layout and Block, or
 * Synced Block's shared content it changed. Writes to Collection Records, Files and Locales aren't
 * on the Canvas, so they touch nothing here.
 */
export const touchesOf = Effect.fn("threads.touchesOf")(function* (db: Database, write: Write) {
  const { name, result } = write;
  switch (name) {
    case "createBlock":
    case "moveBlock":
    case "deleteBlock": {
      const block = writtenBlockSchema.safeParse(result);
      if (!block.success) return [];
      const kind = name === "createBlock" ? "created" : name === "moveBlock" ? "moved" : "deleted";
      return blockTouch(block.data, kind);
    }
    case "editBlock": {
      const block = writtenBlockSchema.safeParse(result);
      if (!block.success) return [];
      // A synced placement's content and settings are its definition's shared content.
      if (yield* isSynced(db, write, block.data.type)) {
        return [
          {
            entity: "synced-block",
            blockType: block.data.type,
            kind: "edited",
            locale: block.data.locale,
          },
        ] satisfies Touch[];
      }
      return blockTouch(block.data, "edited");
    }
    case "createPage":
      return pageTouch(z.object({ page: z.unknown() }).safeParse(result).data?.page, "created");
    case "updatePage":
    case "setPageLayout":
    case "setPageSeo":
      return pageTouch(result, "settings");
    case "deletePage":
      return pageTouch(result, "deleted");
    default:
      return [];
  }
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
