import {
  COMMENT_MESSAGE_MAX_LENGTH,
  commentSchema,
  commentTargetSchema,
  type CommentTarget,
} from "@camox/api-contract";
import { queryKeys } from "@camox/api-contract/query-keys";
import { ORPCError } from "@orpc/server";
import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import { z } from "zod";

import { assertPageAccess } from "../../authorization";
import { broadcastInvalidation } from "../../lib/broadcast-invalidation";
import { stableStringify } from "../../lib/stable-stringify";
import {
  blockDefinitions,
  blocks,
  comments,
  environments,
  repeatableItems,
  user,
} from "../../schema";
import type { ServiceContext } from "../_shared/service-context";

export const listCommentsInput = z.strictObject({ pageId: z.number().int().positive() });
export const createCommentInput = listCommentsInput.extend({
  id: z.uuid(),
  message: z.string().trim().min(1).max(COMMENT_MESSAGE_MAX_LENGTH),
  target: commentTargetSchema,
});

async function authorize(ctx: ServiceContext, pageId: number) {
  if (!ctx.user) throw new ORPCError("UNAUTHORIZED");
  const access = await assertPageAccess(ctx.db, pageId, ctx.user.id);
  if (!access) throw new ORPCError("NOT_FOUND");
  const environment = await ctx.db
    .select()
    .from(environments)
    .where(eq(environments.id, access.page.environmentId))
    .get();
  if (environment?.name !== ctx.environmentName) throw new ORPCError("NOT_FOUND");
  return access;
}

function selectComments(ctx: ServiceContext) {
  return ctx.db
    .select({
      id: comments.id,
      pageId: comments.pageId,
      environmentId: comments.environmentId,
      target: comments.target,
      message: comments.message,
      createdAt: comments.createdAt,
      blockId: comments.blockId,
      itemId: comments.itemId,
      author: { name: user.name, image: user.image },
    })
    .from(comments)
    .innerJoin(user, eq(comments.authorId, user.id));
}

export async function listComments(
  ctx: ServiceContext,
  rawInput: z.input<typeof listCommentsInput>,
) {
  const { pageId } = listCommentsInput.parse(rawInput);
  const { page } = await authorize(ctx, pageId);
  const rows = await selectComments(ctx)
    .where(eq(comments.pageId, pageId))
    .orderBy(asc(comments.createdAt), asc(comments.id));
  const targets = await loadTargets(ctx, page);
  return rows.map((row) => serializeComment(targets, row));
}

function serializeComment(
  targets: TargetLookups,
  row: Awaited<ReturnType<typeof selectComments>>[number],
) {
  let target = row.target;
  if (
    target &&
    (("blockId" in target && row.blockId === null) || ("itemId" in target && row.itemId === null))
  )
    target = null;
  if (target) {
    try {
      validateTarget(targets, target);
    } catch (error) {
      if (!(error instanceof ORPCError) || error.code !== "BAD_REQUEST") throw error;
      target = null;
    }
  }
  return commentSchema.parse({ ...row, target });
}

type FieldSchema = { properties?: Record<string, FieldSchema>; items?: FieldSchema };

// Load the whole page/layout scope, including unreferenced ancestor items. Using a
// subquery keeps both query count and bind parameters independent of feedback count.
async function loadTargets(
  ctx: ServiceContext,
  page: Awaited<ReturnType<typeof authorize>>["page"],
) {
  const scope = or(
    eq(blocks.pageId, page.id),
    page.layoutId === null
      ? undefined
      : and(isNull(blocks.pageId), eq(blocks.layoutId, page.layoutId)),
  );
  const pageBlocks = await ctx.db.select().from(blocks).where(scope);
  const items = await ctx.db
    .select()
    .from(repeatableItems)
    .where(
      inArray(repeatableItems.blockId, ctx.db.select({ id: blocks.id }).from(blocks).where(scope)),
    );
  const definitions = await ctx.db
    .select()
    .from(blockDefinitions)
    .where(eq(blockDefinitions.environmentId, page.environmentId));
  return {
    blocks: new Map(pageBlocks.map((block) => [block.id, block])),
    items: new Map(items.map((item) => [item.id, item])),
    definitions: new Map(definitions.map((definition) => [definition.blockId, definition])),
  };
}

type TargetLookups = Awaited<ReturnType<typeof loadTargets>>;

function validateTarget(targets: TargetLookups, target: CommentTarget) {
  if (target.kind === "page") return;
  const block = targets.blocks.get(target.blockId);
  if (!block) {
    throw new ORPCError("BAD_REQUEST", { message: "Block does not belong to this page" });
  }
  const item = "itemId" in target ? targets.items.get(target.itemId) : undefined;
  if ("itemId" in target && (!item || item.blockId !== block.id)) {
    throw new ORPCError("BAD_REQUEST", { message: "Item does not belong to this block" });
  }
  if (!("fieldName" in target)) return;
  const definition = targets.definitions.get(block.type);
  let schema = definition?.contentSchema as FieldSchema | undefined;
  const path: string[] = [];
  let ancestor = item;
  const seen = new Set<number>();
  while (ancestor) {
    if (seen.has(ancestor.id) || ancestor.blockId !== block.id) {
      throw new ORPCError("BAD_REQUEST", { message: "Invalid item ancestry" });
    }
    seen.add(ancestor.id);
    path.unshift(ancestor.fieldName);
    if (ancestor.parentItemId === null) break;
    ancestor = targets.items.get(ancestor.parentItemId);
    if (!ancestor) throw new ORPCError("BAD_REQUEST", { message: "Invalid item ancestry" });
  }
  for (const field of path) schema = schema?.properties?.[field]?.items;
  if (!schema?.properties || !Object.hasOwn(schema.properties, target.fieldName)) {
    throw new ORPCError("BAD_REQUEST", { message: "Field does not exist on this object" });
  }
}

export async function createComment(
  ctx: ServiceContext,
  rawInput: z.input<typeof createCommentInput>,
) {
  const input = createCommentInput.parse(rawInput);
  const access = await authorize(ctx, input.pageId);
  const existing = await ctx.db.select().from(comments).where(eq(comments.id, input.id)).get();
  let targets: TargetLookups | undefined;
  if (!existing) {
    targets = await loadTargets(ctx, access.page);
    validateTarget(targets, input.target);
  }
  const inserted = existing
    ? undefined
    : await ctx.db
        .insert(comments)
        .values({
          ...input,
          environmentId: access.page.environmentId,
          blockId: "blockId" in input.target ? input.target.blockId : null,
          itemId: "itemId" in input.target ? input.target.itemId : null,
          authorId: ctx.user!.id,
          createdAt: Date.now(),
        })
        .onConflictDoNothing({ target: comments.id })
        .returning()
        .get();
  const row =
    existing ??
    inserted ??
    (await ctx.db.select().from(comments).where(eq(comments.id, input.id)).get());
  if (
    !row ||
    row.authorId !== ctx.user!.id ||
    row.pageId !== input.pageId ||
    row.message !== input.message ||
    stableStringify(row.target) !== stableStringify(input.target)
  ) {
    throw new ORPCError("CONFLICT", { message: "Comment ID already used for a different request" });
  }
  if (inserted) {
    broadcastInvalidation({
      waitUntil: ctx.waitUntil,
      projectRoomNamespace: ctx.env.ProjectRoom,
      projectId: access.projectId,
      targets: [queryKeys.comments.list(input.pageId)],
    });
  }
  const result = await selectComments(ctx).where(eq(comments.id, input.id)).get();
  if (!result) throw new ORPCError("INTERNAL_SERVER_ERROR");
  targets ??= await loadTargets(ctx, access.page);
  return serializeComment(targets, result);
}
