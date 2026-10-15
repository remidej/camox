import {
  COMMENT_MESSAGE_MAX_LENGTH,
  commentSchema,
  commentTargetSchema,
  type Comment,
  type CommentTarget,
} from "@camox/api-contract";
import { generateUuidv7, uuidv7Schema } from "@camox/api-contract/ids";
import { queryKeys } from "@camox/api-contract/query-keys";
import { and, asc, eq, inArray, isNull, or, type SQL } from "drizzle-orm";
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
import { user as users } from "../auth/schema";
import { visibleIn } from "../drafts/overlay";
import { drafts } from "../drafts/schema";
import type { DraftScope } from "../drafts/scope";
import { resolveDraftScope } from "../drafts/service";
import { rootOfItem, sharedContentItemsIn } from "../repeatable-items/roots";

export const listCommentsInput = z.strictObject({ pageId: uuidv7Schema });
/** The server mints the id; a client may mint one for an optimistic insert. */
export const createCommentInput = listCommentsInput.extend({
  id: uuidv7Schema.optional(),
  message: z.string().trim().min(1).max(COMMENT_MESSAGE_MAX_LENGTH),
  target: commentTargetSchema,
});
export const setCommentResolvedInput = listCommentsInput.extend({
  id: uuidv7Schema,
  resolved: z.boolean(),
});

const authorize = Effect.fn("authorize")(function* (ctx: ServiceContext, pageId: string) {
  const currentUser = yield* requireUser(ctx);
  const access = yield* assertPageAccess(ctx.db, pageId, currentUser.id);
  const environment = yield* Effect.promise(() =>
    ctx.db.select().from(environments).where(eq(environments.id, access.page.environmentId)).get(),
  );
  if (environment?.name !== ctx.environmentName) return yield* new NotFoundError();
  const scope = yield* resolveDraftScope(ctx, access.projectId);
  return { ...access, scope };
});

/**
 * The comments a scope sees: Live's, plus a draft's own in that draft (#241). A comment is
 * written where its author is and never moves.
 */
function seenIn(scope: DraftScope): SQL {
  if (!scope) return isNull(comments.draftId);
  return or(isNull(comments.draftId), eq(comments.draftId, scope.id))!;
}

function selectComments(ctx: ServiceContext) {
  return ctx.db
    .select({
      id: comments.id,
      pageId: comments.pageId,
      environmentId: comments.environmentId,
      draftId: comments.draftId,
      addressedInDraftId: comments.addressedInDraftId,
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
  const { page, scope } = yield* authorize(ctx, pageId);
  const rows = yield* Effect.promise(() =>
    selectComments(ctx)
      .where(and(eq(comments.pageId, pageId), seenIn(scope)))
      .orderBy(asc(comments.createdAt), asc(comments.id)),
  );
  const targets = yield* loadTargets(ctx, page, scope);
  return yield* serializeComments(ctx, targets, rows);
});

/**
 * Resolves or reopens a comment the scope sees. Resolving a Live comment from a draft only
 * marks it addressed in that draft, which publishing the draft resolves and discarding it
 * clears (#241). Reopening clears the mark too.
 */
export const setCommentResolved = Effect.fn("comments.setCommentResolved")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof setCommentResolvedInput>,
) {
  const { pageId, id, resolved } = yield* decodeInput(setCommentResolvedInput, rawInput);
  const access = yield* authorize(ctx, pageId);
  const { scope } = access;
  const where = and(eq(comments.id, id), eq(comments.pageId, pageId), seenIn(scope));
  const row = yield* Effect.promise(() => ctx.db.select().from(comments).where(where).get());
  if (!row) return yield* new NotFoundError();
  const addressesLive = scope !== null && row.draftId === null && resolved && !row.resolved;
  const change = addressesLive
    ? { addressedInDraftId: scope.id }
    : { resolved, addressedInDraftId: null };
  yield* Effect.promise(() => ctx.db.update(comments).set(change).where(where));
  broadcastInvalidation({
    waitUntil: ctx.waitUntil,
    projectRoomNamespace: ctx.env.ProjectRoom,
    draftId: row.draftId,
    projectId: access.projectId,
    targets: [queryKeys.comments.list(pageId)],
  });
  const result = yield* Effect.promise(() => selectComments(ctx).where(where).get());
  if (!result) return yield* new NotFoundError();
  const targets = yield* loadTargets(ctx, access.page, scope);
  const [serialized] = yield* serializeComments(ctx, targets, [result]);
  return serialized!;
});

type CommentRow = Awaited<ReturnType<typeof selectComments>>[number];

/** The comments as the API returns them, each saying which draft addressed it, if any. */
const serializeComments = Effect.fn("serializeComments")(function* (
  ctx: ServiceContext,
  targets: TargetLookups,
  rows: CommentRow[],
) {
  const draftIds = [
    ...new Set(rows.flatMap((row) => (row.addressedInDraftId ? [row.addressedInDraftId] : []))),
  ];
  const addressing = draftIds.length
    ? yield* Effect.promise(() =>
        ctx.db
          .select({
            draftId: drafts.id,
            name: drafts.name,
            createdAt: drafts.createdAt,
            creatorName: users.name,
          })
          .from(drafts)
          .leftJoin(users, eq(users.id, drafts.createdBy))
          .where(inArray(drafts.id, draftIds)),
      )
    : [];
  const draftsById = new Map(addressing.map((draft) => [draft.draftId, draft]));
  return yield* Effect.forEach(rows, (row) => {
    const draft = row.addressedInDraftId ? draftsById.get(row.addressedInDraftId) : undefined;
    const addressedIn = draft
      ? {
          draftId: draft.draftId,
          name: draft.name,
          createdBy: { name: draft.creatorName ?? "A former member" },
          createdAt: draft.createdAt,
        }
      : null;
    return serializeComment(targets, row, addressedIn);
  });
});

const serializeComment = Effect.fn("serializeComment")(function* (
  targets: TargetLookups,
  { addressedInDraftId: _addressedInDraftId, ...row }: CommentRow,
  addressedIn: Comment["addressedIn"],
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
  return commentSchema.parse({ ...row, target, addressedIn });
});

type FieldSchema = { properties?: Record<string, FieldSchema>; items?: FieldSchema };

// Load the whole page/layout scope as the draft scope reads it, including unreferenced ancestor
// items. A comment whose anchor the scope doesn't read, such as a block the draft deleted, reads
// as unavailable. Using a subquery keeps both query count and bind parameters independent of
// feedback count.
const loadTargets = Effect.fn("loadTargets")(function* (
  ctx: ServiceContext,
  page: Effect.Success<ReturnType<typeof authorize>>["page"],
  draftScope: DraftScope,
) {
  const scope = and(
    visibleIn(blocks, draftScope),
    or(
      eq(blocks.pageId, page.id),
      page.layoutId === null
        ? undefined
        : and(isNull(blocks.pageId), eq(blocks.layoutId, page.layoutId)),
    ),
  );
  const pageBlocks = yield* Effect.promise(() => ctx.db.select().from(blocks).where(scope));
  const items = yield* Effect.promise(() =>
    ctx.db
      .select()
      .from(repeatableItems)
      .where(
        or(
          inArray(
            repeatableItems.blockId,
            ctx.db.select({ id: blocks.id }).from(blocks).where(scope),
          ),
          // Synced placements show their shared content's items.
          sharedContentItemsIn(page.environmentId),
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

/** Whether a block shows an item: its own, or its synced definition's shared content's. */
function blockShows(block: typeof blocks.$inferSelect, item: typeof repeatableItems.$inferSelect) {
  const root = rootOfItem(item);
  if ("blockId" in root) return root.blockId === block.id;
  const { environmentId, type } = root.sharedContent;
  return environmentId === block.environmentId && type === block.type;
}

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
  if ("itemId" in target && (!item || !blockShows(block, item))) {
    return yield* new InvalidInputError({ message: "Item does not belong to this block" });
  }
  if (!("fieldName" in target)) return;
  const definition = targets.definitions.get(block.type);
  let schema = definition?.contentSchema as FieldSchema | undefined;
  const path: string[] = [];
  let ancestor = item;
  const seen = new Set<string>();
  while (ancestor) {
    if (seen.has(ancestor.id) || !blockShows(block, ancestor)) {
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
  const decoded = yield* decodeInput(createCommentInput, rawInput);
  const input = { ...decoded, id: decoded.id ?? generateUuidv7() };
  const access = yield* authorize(ctx, input.pageId);
  const existing = yield* Effect.promise(() =>
    ctx.db.select().from(comments).where(eq(comments.id, input.id)).get(),
  );
  let targets: TargetLookups | undefined;
  if (!existing) {
    targets = yield* loadTargets(ctx, access.page, access.scope);
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
            draftId: access.scope?.id ?? null,
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
    row.draftId !== (access.scope?.id ?? null) ||
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
      draftId: access.scope?.id ?? null,
      projectId: access.projectId,
      targets: [queryKeys.comments.list(input.pageId)],
    });
  }
  const result = yield* Effect.promise(() =>
    selectComments(ctx).where(eq(comments.id, input.id)).get(),
  );
  if (!result) return yield* Effect.die(new Error(`Comment ${input.id} vanished after insert`));
  targets ??= yield* loadTargets(ctx, access.page, access.scope);
  const [serialized] = yield* serializeComments(ctx, targets, [result]);
  return serialized!;
});
