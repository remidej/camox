import {
  COMMENT_MESSAGE_MAX_LENGTH,
  commentSchema,
  commentTargetSchema,
  type CommentTarget,
} from "@camox/api-contract";
import { queryKeys } from "@camox/api-contract/query-keys";
import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import { Effect } from "effect";
import { z } from "zod";

import { assertPageAccess, requireUser } from "../../authorization";
import { broadcastInvalidation } from "../../lib/broadcast-invalidation";
import { ConflictError, decodeInput, InvalidInputError, NotFoundError } from "../../lib/errors";
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
export const setCommentResolvedInput = listCommentsInput.extend({
  id: z.uuid(),
  resolved: z.boolean(),
});

const authorize = Effect.fn("authorize")(function* (ctx: ServiceContext, pageId: number) {
  const currentUser = yield* requireUser(ctx);
  const access = yield* assertPageAccess(ctx.db, pageId, currentUser.id);
  const environment = yield* Effect.promise(() =>
    ctx.db.select().from(environments).where(eq(environments.id, access.page.environmentId)).get(),
  );
  if (environment?.name !== ctx.environmentName) return yield* new NotFoundError();
  return access;
});

function selectComments(ctx: ServiceContext) {
  return ctx.db
    .select({
      id: comments.id,
      pageId: comments.pageId,
      environmentId: comments.environmentId,
      target: comments.target,
      message: comments.message,
      resolved: comments.resolved,
      createdAt: comments.createdAt,
      blockId: comments.blockId,
      itemId: comments.itemId,
      author: { name: user.name, image: user.image },
    })
    .from(comments)
    .innerJoin(user, eq(comments.authorId, user.id));
}

export const listComments = Effect.fn("comments.listComments")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof listCommentsInput>,
) {
  const { pageId } = yield* decodeInput(listCommentsInput, rawInput);
  const { page } = yield* authorize(ctx, pageId);
  const rows = yield* Effect.promise(() =>
    selectComments(ctx)
      .where(eq(comments.pageId, pageId))
      .orderBy(asc(comments.createdAt), asc(comments.id)),
  );
  const targets = yield* loadTargets(ctx, page);
  return yield* Effect.forEach(rows, (row) => serializeComment(targets, row));
});

export const setCommentResolved = Effect.fn("comments.setCommentResolved")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof setCommentResolvedInput>,
) {
  const { pageId, id, resolved } = yield* decodeInput(setCommentResolvedInput, rawInput);
  const access = yield* authorize(ctx, pageId);
  const scope = and(eq(comments.id, id), eq(comments.pageId, pageId));
  const updated = yield* Effect.promise(() =>
    ctx.db.update(comments).set({ resolved }).where(scope).returning().get(),
  );
  if (!updated) return yield* new NotFoundError();
  broadcastInvalidation({
    waitUntil: ctx.waitUntil,
    projectRoomNamespace: ctx.env.ProjectRoom,
    projectId: access.projectId,
    targets: [queryKeys.comments.list(pageId)],
  });
  const result = yield* Effect.promise(() => selectComments(ctx).where(scope).get());
  if (!result) return yield* new NotFoundError();
  return yield* serializeComment(yield* loadTargets(ctx, access.page), result);
});

const serializeComment = Effect.fn("serializeComment")(function* (
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
    const validTarget = target;
    target = yield* validateTarget(targets, validTarget).pipe(
      Effect.as(validTarget),
      Effect.catchTag("InvalidInputError", () => Effect.succeed(null)),
    );
  }
  return commentSchema.parse({ ...row, target });
});

type FieldSchema = { properties?: Record<string, FieldSchema>; items?: FieldSchema };

// Load the whole page/layout scope, including unreferenced ancestor items. Using a
// subquery keeps both query count and bind parameters independent of feedback count.
const loadTargets = Effect.fn("loadTargets")(function* (
  ctx: ServiceContext,
  page: Effect.Success<ReturnType<typeof authorize>>["page"],
) {
  const scope = or(
    eq(blocks.pageId, page.id),
    page.layoutId === null
      ? undefined
      : and(isNull(blocks.pageId), eq(blocks.layoutId, page.layoutId)),
  );
  const pageBlocks = yield* Effect.promise(() => ctx.db.select().from(blocks).where(scope));
  const items = yield* Effect.promise(() =>
    ctx.db
      .select()
      .from(repeatableItems)
      .where(
        inArray(
          repeatableItems.blockId,
          ctx.db.select({ id: blocks.id }).from(blocks).where(scope),
        ),
      ),
  );
  const definitions = yield* Effect.promise(() =>
    ctx.db
      .select()
      .from(blockDefinitions)
      .where(eq(blockDefinitions.environmentId, page.environmentId)),
  );
  return {
    blocks: new Map(pageBlocks.map((block) => [block.id, block])),
    items: new Map(items.map((item) => [item.id, item])),
    definitions: new Map(definitions.map((definition) => [definition.blockId, definition])),
  };
});

type TargetLookups = Effect.Success<ReturnType<typeof loadTargets>>;

const validateTarget = Effect.fn("validateTarget")(function* (
  targets: TargetLookups,
  target: CommentTarget,
) {
  if (target.kind === "page") return;
  const block = targets.blocks.get(target.blockId);
  if (!block) {
    return yield* new InvalidInputError({ message: "Block does not belong to this page" });
  }
  const item = "itemId" in target ? targets.items.get(target.itemId) : undefined;
  if ("itemId" in target && (!item || item.blockId !== block.id)) {
    return yield* new InvalidInputError({ message: "Item does not belong to this block" });
  }
  if (!("fieldName" in target)) return;
  const definition = targets.definitions.get(block.type);
  let schema = definition?.contentSchema as FieldSchema | undefined;
  const path: string[] = [];
  let ancestor = item;
  const seen = new Set<number>();
  while (ancestor) {
    if (seen.has(ancestor.id) || ancestor.blockId !== block.id) {
      return yield* new InvalidInputError({ message: "Invalid item ancestry" });
    }
    seen.add(ancestor.id);
    path.unshift(ancestor.fieldName);
    if (ancestor.parentItemId === null) break;
    ancestor = targets.items.get(ancestor.parentItemId);
    if (!ancestor) return yield* new InvalidInputError({ message: "Invalid item ancestry" });
  }
  for (const field of path) schema = schema?.properties?.[field]?.items;
  if (!schema?.properties || !Object.hasOwn(schema.properties, target.fieldName)) {
    return yield* new InvalidInputError({ message: "Field does not exist on this object" });
  }
});

export const createComment = Effect.fn("comments.createComment")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof createCommentInput>,
) {
  const input = yield* decodeInput(createCommentInput, rawInput);
  const access = yield* authorize(ctx, input.pageId);
  const existing = yield* Effect.promise(() =>
    ctx.db.select().from(comments).where(eq(comments.id, input.id)).get(),
  );
  let targets: TargetLookups | undefined;
  if (!existing) {
    targets = yield* loadTargets(ctx, access.page);
    yield* validateTarget(targets, input.target);
  }
  const inserted = existing
    ? undefined
    : yield* Effect.promise(() =>
        ctx.db
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
          .get(),
      );
  const row =
    existing ??
    inserted ??
    (yield* Effect.promise(() =>
      ctx.db.select().from(comments).where(eq(comments.id, input.id)).get(),
    ));
  if (
    !row ||
    row.authorId !== ctx.user!.id ||
    row.pageId !== input.pageId ||
    row.message !== input.message ||
    stableStringify(row.target) !== stableStringify(input.target)
  ) {
    return yield* new ConflictError({
      message: "Comment ID already used for a different request",
    });
  }
  if (inserted) {
    broadcastInvalidation({
      waitUntil: ctx.waitUntil,
      projectRoomNamespace: ctx.env.ProjectRoom,
      projectId: access.projectId,
      targets: [queryKeys.comments.list(input.pageId)],
    });
  }
  const result = yield* Effect.promise(() =>
    selectComments(ctx).where(eq(comments.id, input.id)).get(),
  );
  if (!result) return yield* Effect.die(new Error(`Comment ${input.id} vanished after insert`));
  targets ??= yield* loadTargets(ctx, access.page);
  return yield* serializeComment(targets, result);
});
