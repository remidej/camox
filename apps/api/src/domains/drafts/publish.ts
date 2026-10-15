import type { EndedDraft } from "@camox/api-contract/drafts";
import { queryKeys } from "@camox/api-contract/query-keys";
import { and, eq, inArray, sql } from "drizzle-orm";
import { Effect } from "effect";
import { z } from "zod";

import { getAuthorizedProject, requireUser } from "../../authorization";
import { broadcastDraftEnded, broadcastInvalidation } from "../../lib/broadcast-invalidation";
import {
  ConflictsChangedError,
  decodeInput,
  InvalidInputError,
  PublishBlockedError,
} from "../../lib/errors";
import { lexicalStateToPlainText } from "../../lib/lexical-state";
import {
  blockDefinitions,
  blocks,
  collectionDefinitions,
  collectionRecords,
  environments,
  pages,
} from "../../schema";
import { conformRecordContent } from "../_shared/conform-content";
import type { ServiceContext } from "../_shared/service-context";
import { user as users } from "../auth/schema";
import * as overlay from "./overlay";
import type { DraftScope } from "./scope";
import { findEndedDraft, resolveDraftScope } from "./service";

// Publishing a draft and discarding it (ADR 0009). The preview lists what publishing will do;
// its token records the conflicts it showed, and publishing aborts when they've changed since.

type Scope = NonNullable<DraftScope>;
type BlockRow = typeof blocks.$inferSelect;
type RecordRow = typeof collectionRecords.$inferSelect;

/** Where an entity sits, so people can find it: its page, its layout or its collection. */
export type Owner =
  | { kind: "page"; id: string; path: string; nickname: string }
  | { kind: "layout"; name: string }
  | { kind: "collection"; name: string; title: string }
  | null;

/** An entity as people know it. */
export type Subject = {
  entity: string;
  id: string;
  /** What the entity is to people, e.g. a block's summary or its definition's title. */
  label: string;
  owner: Owner;
};

export type Change = Subject & { change: "created" | "changed" | "deleted" };

export type Conflict = Subject & {
  /** Live's version now, or null when Live deleted the entity. */
  liveVersion: number | null;
  publishedBy: { id: string; name: string } | null;
  publishedAt: number | null;
};

export type LostChange = Subject & { reason: "parentGone" | "writtenAfterDeletion" };

/** A blocker, or the same problem already on Live as a warning, naming what to fix. */
export type Problem = Subject & {
  code: "emptyRequiredReference";
  field: string;
  message: string;
};

export type PublishPreview = {
  blockers: Problem[];
  conflicts: Conflict[];
  lost: LostChange[];
  warnings: Problem[];
  changes: Change[];
  /** Sent back to publish, which aborts when the conflicts no longer match it. */
  token: string;
};

export const previewPublishInput = z.object({ projectId: z.number() });
export const publishInput = z.object({ projectId: z.number(), token: z.string() });
export const discardInput = z.object({ projectId: z.number() });

const tokenSchema = z.array(z.tuple([z.string(), z.string(), z.number().nullable()]));

function encodeToken(conflicts: overlay.StoredConflict[]): string {
  const keys: overlay.ConflictKey[] = conflicts
    .map((conflict): overlay.ConflictKey => [conflict.entity, conflict.id, conflict.liveVersion])
    .sort((a, b) => (`${a[0]}:${a[1]}` < `${b[0]}:${b[1]}` ? -1 : 1));
  return btoa(JSON.stringify(keys));
}

const decodeToken = (token: string) =>
  Effect.try({
    try: () => tokenSchema.parse(JSON.parse(atob(token))) as overlay.ConflictKey[],
    catch: () => new InvalidInputError({ message: "Invalid publish token" }),
  });

// --- Describing entities ---

/** Labels and owners for blocks, from the rows the draft or Live holds. */
const blockDescriber = Effect.fn("drafts.blockDescriber")(function* (
  ctx: ServiceContext,
  projectId: number,
  rows: BlockRow[],
) {
  const pageIds = [...new Set(rows.flatMap((row) => (row.pageId ? [row.pageId] : [])))];
  const pageRows = pageIds.length
    ? yield* Effect.promise(() =>
        ctx.db
          .select({ id: pages.id, fullPath: pages.fullPath, nickname: pages.nickname })
          .from(pages)
          .where(inArray(pages.id, pageIds)),
      )
    : [];
  const pagesById = new Map(pageRows.map((page) => [page.id, page]));
  const definitions = yield* Effect.promise(() =>
    ctx.db
      .select({ blockId: blockDefinitions.blockId, title: blockDefinitions.title })
      .from(blockDefinitions)
      .where(eq(blockDefinitions.projectId, projectId)),
  );
  const titles = new Map(definitions.map((definition) => [definition.blockId, definition.title]));
  const byId = new Map(rows.map((row) => [row.id, row]));

  return (id: string): Subject => {
    const row = byId.get(id);
    if (!row) return { entity: "block", id, label: "Block", owner: null };
    const page = row.pageId ? pagesById.get(row.pageId) : undefined;
    let owner: Owner = null;
    if (page) owner = { kind: "page", id: page.id, path: page.fullPath, nickname: page.nickname };
    else if (row.layoutId) owner = { kind: "layout", name: row.layoutId };
    return {
      entity: "block",
      id,
      label: row.summary || titles.get(row.type) || row.type,
      owner,
    };
  };
});

/** Labels for records, from the rows the draft holds, each under its collection. */
const recordDescriber = Effect.fn("drafts.recordDescriber")(function* (
  ctx: ServiceContext,
  projectId: number,
  rows: RecordRow[],
) {
  const definitions = yield* Effect.promise(() =>
    ctx.db
      .select()
      .from(collectionDefinitions)
      .where(eq(collectionDefinitions.projectId, projectId)),
  );
  const definitionOf = (row: RecordRow) =>
    definitions.find(
      (definition) =>
        definition.environmentId === row.environmentId &&
        definition.collectionId === row.collectionId,
    );
  const byId = new Map(rows.map((row) => [row.id, row]));

  return (id: string): Subject => {
    const row = byId.get(id);
    if (!row) return { entity: "record", id, label: "Record", owner: null };
    const definition = definitionOf(row);
    // A record of a removed collection is still named by its collection's name (ADR 0007).
    if (!definition) {
      const owner: Owner = { kind: "collection", name: row.collectionId, title: row.collectionId };
      return { entity: "record", id, label: "Record", owner };
    }
    const content = conformRecordContent(definition.contentSchema, row.content);
    const label = lexicalStateToPlainText(
      content[definition.label] as string | Record<string, unknown>,
    );
    return {
      entity: "record",
      id,
      label: label || "Untitled record",
      owner: { kind: "collection", name: definition.collectionId, title: definition.title },
    };
  };
});

// --- Blockers ---

/** Live blocks of a project the draft doesn't store: untouched Live content. */
const untouchedLiveBlocks = (ctx: ServiceContext, scope: Scope) =>
  Effect.promise(() =>
    ctx.db
      .select()
      .from(blocks)
      .where(
        and(
          overlay.visibleIn(blocks, null),
          inArray(
            blocks.environmentId,
            ctx.db
              .select({ id: environments.id })
              .from(environments)
              .where(eq(environments.projectId, scope.projectId)),
          ),
          sql`not exists (select 1 from ${blocks} as "copy" where "copy"."draft_id" = ${scope.id} and "copy"."id" = ${blocks.id})`,
        ),
      ),
  );

type FieldSchema = { fieldType?: string; required?: unknown; title?: string };

/**
 * Required references left empty, per block. Synced blocks hold their content elsewhere, so
 * their placements are skipped.
 */
const emptyRequiredReferences = Effect.fn("drafts.emptyRequiredReferences")(function* (
  ctx: ServiceContext,
  projectId: number,
  rows: BlockRow[],
) {
  const definitions = yield* Effect.promise(() =>
    ctx.db.select().from(blockDefinitions).where(eq(blockDefinitions.projectId, projectId)),
  );
  const byName = new Map(definitions.map((definition) => [definition.blockId, definition]));
  const found: { id: string; field: string; title: string }[] = [];
  for (const row of rows) {
    const definition = byName.get(row.type);
    if (!definition || definition.synced) continue;
    const properties =
      (definition.contentSchema as { properties?: Record<string, FieldSchema> }).properties ?? {};
    const content = (row.content ?? {}) as Record<string, unknown>;
    for (const [field, schema] of Object.entries(properties)) {
      if (schema.fieldType !== "Reference" || schema.required !== true) continue;
      const value = content[field];
      if (value !== null && value !== undefined && value !== "") continue;
      found.push({ id: row.id, field, title: schema.title ?? field });
    }
  }
  return found;
});

/**
 * Blockers in what the draft changed, and the same problems in untouched Live content as
 * warnings. Each check sees the blocks the draft creates or changes, and Live's untouched ones.
 */
const checkProblems = Effect.fn("drafts.checkProblems")(function* (
  ctx: ServiceContext,
  scope: Scope,
  changed: BlockRow[],
) {
  const untouched = yield* untouchedLiveBlocks(ctx, scope);
  const describe = yield* blockDescriber(ctx, scope.projectId, [...changed, ...untouched]);
  const problems = (found: { id: string; field: string; title: string }[]): Problem[] =>
    found.map(({ id, field, title }) => ({
      ...describe(id),
      code: "emptyRequiredReference",
      field,
      message: `"${title}" is required but empty`,
    }));
  return {
    blockers: problems(yield* emptyRequiredReferences(ctx, scope.projectId, changed)),
    warnings: problems(yield* emptyRequiredReferences(ctx, scope.projectId, untouched)),
  };
});

// --- Preview ---

const computePreview = Effect.fn("drafts.computePreview")(function* (
  ctx: ServiceContext,
  scope: Scope,
) {
  const stored = yield* overlay.changesOf(ctx.db, scope);
  const storedConflicts = yield* overlay.conflictsOf(ctx.db, scope);
  const losses = yield* overlay.lostOf(ctx.db, scope);
  const blockRows = stored
    .filter((change) => change.table === blocks)
    .map((c) => c.row as BlockRow);
  const describeBlock = yield* blockDescriber(ctx, scope.projectId, blockRows);
  const describeRecord = yield* recordDescriber(
    ctx,
    scope.projectId,
    stored.filter((change) => change.table === collectionRecords).map((c) => c.row as RecordRow),
  );
  const describers: Record<string, (id: string) => Subject> = { record: describeRecord };
  const describe = (id: string, entity = "block") => (describers[entity] ?? describeBlock)(id);

  const changed = blockRows.filter((row) => !row.deleted);
  const { blockers, warnings } = yield* checkProblems(ctx, scope, changed);

  const publisherIds = [
    ...new Set(storedConflicts.flatMap((c) => (c.publishedBy ? [c.publishedBy] : []))),
  ];
  const publishers = publisherIds.length
    ? yield* Effect.promise(() =>
        ctx.db
          .select({ id: users.id, name: users.name })
          .from(users)
          .where(inArray(users.id, publisherIds)),
      )
    : [];
  const publisherById = new Map(publishers.map((publisher) => [publisher.id, publisher]));

  const conflicts: Conflict[] = storedConflicts.map((conflict) => ({
    ...describe(conflict.id, conflict.entity),
    liveVersion: conflict.liveVersion,
    publishedBy: (conflict.publishedBy && publisherById.get(conflict.publishedBy)) || null,
    publishedAt: conflict.publishedAt,
  }));
  const lost: LostChange[] = losses.map((loss) => {
    if (loss.reason === "parentGone") {
      return { ...describe(loss.id, loss.entity), reason: loss.reason };
    }
    const parent = describe(loss.parent.id, loss.parent.entity);
    return {
      entity: "repeatableItem",
      id: loss.id,
      label: `Item added to ${parent.label} after it was deleted`,
      owner: parent.owner,
      reason: loss.reason,
    };
  });
  const changes: Change[] = stored.map(({ entity, row, change }) => ({
    ...describe(row.id, entity),
    change,
  }));

  return {
    blockers,
    conflicts,
    lost,
    warnings,
    changes,
    token: encodeToken(storedConflicts),
  } satisfies PublishPreview;
});

/** The draft a request names, which publishing and discarding need. */
const requireDraft = Effect.fn("drafts.requireDraft")(function* (
  ctx: ServiceContext,
  projectId: number,
) {
  const scope = yield* resolveDraftScope(ctx, projectId);
  if (!scope) {
    return yield* new InvalidInputError({ message: "Live isn't a draft: name one to publish" });
  }
  return scope;
});

/** What publishing the request's draft will do, with the token to publish it. */
export const previewPublish = Effect.fn("drafts.previewPublish")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof previewPublishInput>,
) {
  const { projectId } = yield* decodeInput(previewPublishInput, rawInput);
  const scope = yield* requireDraft(ctx, projectId);
  return yield* computePreview(ctx, scope);
});

/**
 * How the request's draft ended earlier, so a retried publish or discard reports it instead of
 * applying anything again.
 */
const endedEarlier = Effect.fn("drafts.endedEarlier")(function* (
  ctx: ServiceContext,
  projectId: number,
) {
  const user = yield* requireUser(ctx);
  yield* getAuthorizedProject(ctx.db, projectId, user.id);
  if (!ctx.draft) return undefined;
  return yield* findEndedDraft(ctx.db, projectId, ctx.draft.id);
});

const roomOf = (ctx: ServiceContext, projectId: number) => ({
  waitUntil: ctx.waitUntil,
  projectRoomNamespace: ctx.env.ProjectRoom,
  projectId,
});

/** Refreshes every viewer of Live, which the publish changed. */
const broadcastPublished = (ctx: ServiceContext, projectId: number) =>
  broadcastInvalidation({
    ...roomOf(ctx, projectId),
    draftId: null,
    targets: [
      queryKeys.pages.getByPathAll,
      queryKeys.pages.list,
      queryKeys.layouts.all,
      ["camox", "blocks"],
      ["camox", "collections"],
    ],
  });

/** Switches the ended draft's viewers to Live, saying who ended it and how. */
const broadcastEnded = (ctx: ServiceContext, projectId: number, ended: EndedDraft | null) => {
  if (ended) broadcastDraftEnded({ ...roomOf(ctx, projectId), ended });
};

/**
 * Publishes the request's draft whole, once it has no blockers, if its conflicts are still
 * those the token was given for. Returns how the draft ended, also when an earlier attempt
 * ended it, or null for an empty draft, which publishing leaves as is.
 */
export const publishDraft = Effect.fn("drafts.publishDraft")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof publishInput>,
) {
  const { projectId, token } = yield* decodeInput(publishInput, rawInput);
  const earlier = yield* endedEarlier(ctx, projectId);
  if (earlier) return { ended: earlier as EndedDraft | null };

  const scope = yield* requireDraft(ctx, projectId);
  const shown = yield* decodeToken(token);
  const stored = yield* overlay.changesOf(ctx.db, scope);
  if (stored.length === 0) return { ended: null };

  const preview = yield* computePreview(ctx, scope);
  if (preview.blockers.length > 0) {
    return yield* new PublishBlockedError({
      message: `The draft has ${preview.blockers.length} blocker(s) to fix before publishing`,
    });
  }

  const user = yield* requireUser(ctx);
  const applied = yield* Effect.result(
    overlay.publish(ctx.db, scope, { shown, publishedBy: user.id, now: Date.now() }),
  );
  if (applied._tag === "Failure") {
    // A concurrent publish or discard may have ended the draft; otherwise Live changed.
    const ended = yield* findEndedDraft(ctx.db, projectId, scope.id);
    if (ended) return { ended };
    return yield* new ConflictsChangedError({
      message: "Live changed since the preview. Review the new preview before publishing.",
    });
  }

  broadcastPublished(ctx, projectId);
  const ended = (yield* findEndedDraft(ctx.db, projectId, scope.id)) ?? null;
  broadcastEnded(ctx, projectId, ended);
  return { ended };
});

/**
 * Discards the request's draft: a regular draft is deleted with every row it stores, a
 * development draft is emptied. Returns how the draft ended, also when an earlier attempt
 * ended it.
 */
export const discardDraft = Effect.fn("drafts.discardDraft")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof discardInput>,
) {
  const { projectId } = yield* decodeInput(discardInput, rawInput);
  const earlier = yield* endedEarlier(ctx, projectId);
  if (earlier) return { ended: earlier as EndedDraft | null };

  const scope = yield* requireDraft(ctx, projectId);
  const user = yield* requireUser(ctx);
  const result = yield* Effect.result(
    overlay.discard(ctx.db, scope, { discardedBy: user.id, now: Date.now() }),
  );
  const ended = (yield* findEndedDraft(ctx.db, projectId, scope.id)) ?? null;
  if (result._tag === "Failure" && !ended) return yield* Effect.die(result.failure);
  if (result._tag === "Success") broadcastEnded(ctx, projectId, ended);
  return { ended };
});
