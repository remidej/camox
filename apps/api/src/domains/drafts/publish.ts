import type { EndedDraft } from "@camox/api-contract/drafts";
import { queryKeys } from "@camox/api-contract/query-keys";
import { and, eq, inArray, type SQL } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
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
  comments,
  files,
  layouts,
  pages,
  repeatableItems,
  sharedContents,
} from "../../schema";
import { conformRecordContent } from "../_shared/conform-content";
import { definitionsIn } from "../_shared/definitions";
import type { ServiceContext } from "../_shared/service-context";
import { user as users } from "../auth/schema";
import { sharedPlacementId } from "../blocks/shared-content";
import * as draftComments from "../comments/drafts";
import { metadataGenerated, withFileMetadata } from "../files/generated-metadata";
import { checkFileProblems, type FileProblemCode, type Finding } from "../files/publish-checks";
import { blobsOfDraft, deleteUnreferencedBlobs } from "../files/service";
import type { GeneratedEntity } from "../generated-values/schema";
import * as generatedValueStatements from "../generated-values/service";
import { homeOf, readValues, requestGeneration } from "../generated-values/service";
import { requestPageSeo } from "../pages/service";
import { rootOfItem } from "../repeatable-items/roots";
import {
  checkContentProblems,
  type ContentFinding,
  type ContentProblemCode,
} from "./content-checks";
import * as overlay from "./overlay";
import type { DraftScope } from "./scope";
import { findEndedDraft, resolveDraftScope } from "./service";

// Publishing a draft and discarding it (ADR 0009). The preview lists what publishing will do;
// its token records the conflicts it showed, and publishing aborts when they've changed since.

type Scope = NonNullable<DraftScope>;
type BlockRow = typeof blocks.$inferSelect;
type RecordRow = typeof collectionRecords.$inferSelect;
type FileRow = typeof files.$inferSelect;

/**
 * Where an entity sits, so people can find it: its page, its layout, its synced block or its
 * collection.
 */
export type Owner =
  | { kind: "page"; id: string; path: string; nickname: string }
  | { kind: "layout"; name: string }
  | { kind: "syncedBlock"; name: string; title: string }
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
  /** Whether a release made Live's version, which no member published (ADR 0006). */
  release: boolean;
};

export type LostChange = Subject & { reason: "parentGone" | "writtenAfterDeletion" };

/** A blocker, or the same problem already on Live as a warning, naming what to fix. */
export type Problem = Subject & {
  code:
    | "unresolvedComment"
    | "commentDeleted"
    | "definitionsDiffer"
    | FileProblemCode
    | ContentProblemCode;
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

/** The rows of `ids` the draft holds, or Live's where it holds none. */
const rowsSeenBy = <T extends overlay.ContentTable>(
  ctx: ServiceContext,
  scope: Scope,
  table: T,
  ids: string[],
) =>
  Effect.gen(function* () {
    if (ids.length === 0) return new Map<string, T["$inferSelect"]>();
    const rows = (yield* Effect.promise(() =>
      ctx.db
        .select()
        .from(table as SQLiteTable)
        .where(and(inArray(table.id, ids), overlay.storedInLiveOrDraft(table, scope.id))),
    )) as T["$inferSelect"][];
    const byId = new Map<string, T["$inferSelect"]>();
    for (const row of rows) {
      if (!byId.has(row.id) || row.draftId !== null) byId.set(row.id, row);
    }
    return byId;
  });

type Mention = { entity: string; id: string };

/**
 * Labels and owners for the entities a preview mentions, from the rows the draft holds or
 * Live's: a block or item sits on its page or layout, or in its synced block; a page is its own.
 */
const describer = Effect.fn("drafts.describer")(function* (
  ctx: ServiceContext,
  scope: Scope,
  mentions: Mention[],
) {
  const idsOf = (entity: string) => [
    ...new Set(mentions.filter((m) => m.entity === entity).map((m) => m.id)),
  ];
  const items = yield* rowsSeenBy(ctx, scope, repeatableItems, idsOf("repeatableItem"));
  const blockIds = [
    ...idsOf("block"),
    ...[...items.values()].flatMap((item) => (item.blockId ? [item.blockId] : [])),
  ];
  const blockRows = yield* rowsSeenBy(ctx, scope, blocks, [...new Set(blockIds)]);
  const pageIds = [
    ...idsOf("page"),
    ...[...blockRows.values()].flatMap((row) => (row.pageId ? [row.pageId] : [])),
  ];
  const pageRows = yield* rowsSeenBy(ctx, scope, pages, [...new Set(pageIds)]);
  const shared = yield* rowsSeenBy(ctx, scope, sharedContents, idsOf("sharedContent"));
  // Summaries are generated values the draft reads (ADR 0012).
  const summary = (entity: GeneratedEntity, ids: Iterable<string>) =>
    Effect.map(
      readValues(ctx.db, scope, entity, "summary", [...ids]),
      (values) => (id: string) => values.get(id)?.value?.summary ?? "",
    );
  const sharedSummary = yield* summary("sharedContent", shared.keys());
  const itemSummary = yield* summary("repeatableItem", items.keys());
  const blockSummary = yield* summary("block", blockRows.keys());
  const definitions = yield* Effect.promise(() =>
    ctx.db
      .select({ blockId: blockDefinitions.blockId, title: blockDefinitions.title })
      .from(blockDefinitions)
      .where(
        and(
          eq(blockDefinitions.projectId, scope.projectId),
          definitionsIn(blockDefinitions, scope),
        ),
      ),
  );
  const titles = new Map(definitions.map((definition) => [definition.blockId, definition.title]));

  const pageOwner = (pageId: string | null): Owner => {
    const page = pageId ? pageRows.get(pageId) : undefined;
    return page
      ? { kind: "page", id: page.id, path: page.fullPath, nickname: page.nickname }
      : null;
  };
  const syncedOwner = (type: string): Owner => ({
    kind: "syncedBlock",
    name: type,
    title: titles.get(type) ?? type,
  });
  const blockOwner = (block: BlockRow | undefined): Owner => {
    if (!block) return null;
    if (block.pageId) return pageOwner(block.pageId);
    if (block.layoutId) return { kind: "layout", name: block.layoutId };
    return null;
  };

  return (entity: string, id: string): Subject => {
    if (entity === "page") {
      return { entity, id, label: "Page", owner: pageOwner(id) };
    }
    if (entity === "sharedContent") {
      const row = shared.get(id);
      const type = row?.type ?? id;
      return {
        entity,
        id,
        label: sharedSummary(id) || "Shared content",
        owner: syncedOwner(type),
      };
    }
    if (entity === "repeatableItem") {
      const item = items.get(id);
      let owner: Owner = null;
      if (item?.sharedContentType) owner = syncedOwner(item.sharedContentType);
      else if (item?.blockId) owner = blockOwner(blockRows.get(item.blockId));
      return { entity, id, label: itemSummary(id) || "Item", owner };
    }
    const row = blockRows.get(id);
    if (!row) return { entity, id, label: "Block", owner: null };
    return {
      entity,
      id,
      label: blockSummary(id) || titles.get(row.type) || row.type,
      owner: blockOwner(row),
    };
  };
});

/** A file as people know it: by its filename. Files belong to no page or layout. */
const describeFile = (id: string, file?: { filename: string }): Subject => ({
  entity: "file",
  id,
  label: file?.filename ?? "File",
  owner: null,
});

/** Labels for records, from the rows the draft holds, each under its collection. */
const recordDescriber = Effect.fn("drafts.recordDescriber")(function* (
  ctx: ServiceContext,
  scope: Scope,
  rows: RecordRow[],
) {
  const definitions = yield* Effect.promise(() =>
    ctx.db
      .select()
      .from(collectionDefinitions)
      .where(
        and(
          eq(collectionDefinitions.projectId, scope.projectId),
          definitionsIn(collectionDefinitions, scope),
        ),
      ),
  );
  const definitionOf = (row: RecordRow) =>
    definitions.find(
      (definition) =>
        definition.projectId === row.projectId && definition.collectionId === row.collectionId,
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

/** Feedback as a problem: on its page, naming the field it's anchored to, if any. */
const commentProblems = Effect.fn("drafts.commentProblems")(function* (
  ctx: ServiceContext,
  where: SQL,
  code: Problem["code"],
  message: string,
) {
  const rows = yield* Effect.promise(() =>
    ctx.db
      .select({
        id: comments.id,
        message: comments.message,
        target: comments.target,
        page: { id: pages.id, path: pages.fullPath, nickname: pages.nickname },
      })
      .from(comments)
      .leftJoin(pages, eq(pages.id, comments.pageId))
      .where(where),
  );
  return rows.map(
    (row): Problem => ({
      entity: "comment",
      id: row.id,
      label: `Feedback "${excerpt(row.message)}"`,
      owner: row.page ? { kind: "page", ...row.page } : null,
      code,
      field: row.target && "fieldName" in row.target ? row.target.fieldName : "",
      message,
    }),
  );
});

const EXCERPT_LENGTH = 60;

function excerpt(text: string) {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > EXCERPT_LENGTH ? `${line.slice(0, EXCERPT_LENGTH - 1)}…` : line;
}

/**
 * Unresolved feedback written in the draft blocks publishing it. Unresolved Live feedback on
 * what the draft deletes is a warning: publishing deletes it (#241).
 */
const checkComments = Effect.fn("drafts.checkComments")(function* (
  ctx: ServiceContext,
  scope: Scope,
) {
  return {
    blockers: yield* commentProblems(
      ctx,
      draftComments.unresolvedCommentsWrittenIn(scope.id),
      "unresolvedComment",
      "Unresolved feedback written in this draft: resolve it before publishing",
    ),
    warnings: yield* commentProblems(
      ctx,
      draftComments.unresolvedLiveCommentsDeletedBy(scope.id),
      "commentDeleted",
      "Unresolved feedback on content this draft deletes: publishing deletes it",
    ),
  };
});

/**
 * Content and file findings as problems, each naming the entity it's in and where that sits.
 */
const findingDescriber = Effect.fn("drafts.findingDescriber")(function* (
  ctx: ServiceContext,
  scope: Scope,
  findings: (ContentFinding | Finding)[],
  records: RecordRow[],
  fileRows: Map<string, { filename: string }>,
) {
  const describeContent = yield* describer(ctx, scope, findings);
  const ids = new Set(findings.flatMap((f) => (f.entity === "record" ? [f.id] : [])));
  const describeRecord = yield* recordDescriber(
    ctx,
    scope,
    records.filter((record) => ids.has(record.id)),
  );
  const describe = (entity: string, id: string) => {
    if (entity === "record") return describeRecord(id);
    if (entity === "file") return describeFile(id, fileRows.get(id));
    return describeContent(entity, id);
  };
  return ({ entity, id, code, field, message }: ContentFinding | Finding): Problem => ({
    ...describe(entity, id),
    code,
    field,
    message,
  });
});

// --- Definitions of a development draft (ADR 0006) ---

type DefinitionRow = { name: string; schemaHash: string };

const DEFINITION_KINDS = [
  { kind: "block", label: "Block", table: blockDefinitions, name: blockDefinitions.blockId },
  { kind: "layout", label: "Layout", table: layouts, name: layouts.layoutId },
  {
    kind: "collection",
    label: "Collection",
    table: collectionDefinitions,
    name: collectionDefinitions.collectionId,
  },
] as const;

/**
 * A development draft publishes only while its definitions match Live's: the same names, and
 * the same schema hash for each (ADR 0006). Each definition that differs is a blocker, until a
 * release gives Live the same definitions. Regular drafts read Live's definitions.
 */
const checkDefinitions = Effect.fn("drafts.checkDefinitions")(function* (
  ctx: ServiceContext,
  scope: Scope,
) {
  if (scope.kind !== "development") return [];
  const blockers: Problem[] = [];
  for (const { kind, label, table, name } of DEFINITION_KINDS) {
    const read = (definitions: DraftScope) =>
      Effect.promise(() =>
        ctx.db
          .select({ name, schemaHash: table.schemaHash })
          .from(table)
          .where(and(eq(table.projectId, scope.projectId), definitionsIn(table, definitions))),
      ) as Effect.Effect<DefinitionRow[]>;
    const live = new Map((yield* read(null)).map((row) => [row.name, row.schemaHash]));
    const local = new Map((yield* read(scope)).map((row) => [row.name, row.schemaHash]));
    const blocker = (definition: string, message: string): Problem => ({
      entity: "definition",
      id: `${kind}:${definition}`,
      label: `${label} "${definition}"`,
      owner: null,
      code: "definitionsDiffer",
      field: "",
      message,
    });
    for (const [definition, hash] of local) {
      if (!live.has(definition)) {
        blockers.push(blocker(definition, "Only in your local code: release it before publishing"));
        continue;
      }
      if (live.get(definition) !== hash) {
        blockers.push(
          blocker(definition, "Differs from Live's: release your local code before publishing"),
        );
      }
    }
    for (const definition of live.keys()) {
      if (local.has(definition)) continue;
      blockers.push(
        blocker(
          definition,
          "On Live but not in your local code: sync or release before publishing",
        ),
      );
    }
  }
  return blockers.sort((a, b) => (a.id < b.id ? -1 : 1));
});

// --- Preview ---

const computePreview = Effect.fn("drafts.computePreview")(function* (
  ctx: ServiceContext,
  scope: Scope,
) {
  const stored = yield* overlay.changesOf(ctx.db, scope);
  const storedConflicts = yield* overlay.conflictsOf(ctx.db, scope);
  const losses = yield* overlay.lostOf(ctx.db, scope);
  const describeContent = yield* describer(ctx, scope, [
    ...stored.map(({ entity, row }) => ({ entity, id: row.id })),
    ...storedConflicts,
    ...losses.flatMap((loss) => (loss.reason === "parentGone" ? [loss] : [loss, loss.parent])),
  ]);
  const describeRecord = yield* recordDescriber(
    ctx,
    scope,
    stored.filter((change) => change.table === collectionRecords).map((c) => c.row as RecordRow),
  );
  const fileNames = new Map(
    (yield* withFileMetadata(
      ctx.db,
      scope,
      stored.flatMap((change) => (change.entity === "file" ? [change.row as FileRow] : [])),
    )).map((file) => [file.id, file] as const),
  );
  const describe = (entity: string, id: string) => {
    if (entity === "record") return describeRecord(id);
    if (entity === "file") return describeFile(id, fileNames.get(id));
    return describeContent(entity, id);
  };

  const feedback = yield* checkComments(ctx, scope);
  const checked = yield* checkContentProblems(ctx, scope);
  const fileChecks = yield* checkFileProblems(ctx, scope, checked.holders);
  const describeFinding = yield* findingDescriber(
    ctx,
    scope,
    [...fileChecks.blockers, ...fileChecks.warnings, ...checked.blockers, ...checked.warnings],
    checked.records,
    fileChecks.files,
  );
  const blockers = [
    ...(yield* checkDefinitions(ctx, scope)),
    ...fileChecks.blockers.map(describeFinding),
    ...checked.blockers.map(describeFinding),
    ...feedback.blockers,
  ];
  const warnings = [
    ...fileChecks.warnings.map(describeFinding),
    ...checked.warnings.map(describeFinding),
    ...feedback.warnings,
  ];

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
    ...describe(conflict.entity, conflict.id),
    liveVersion: conflict.liveVersion,
    publishedBy: (conflict.publishedBy && publisherById.get(conflict.publishedBy)) || null,
    publishedAt: conflict.publishedAt,
    release: conflict.publishedAt !== null && conflict.publishedBy === null,
  }));
  const lost: LostChange[] = losses.map((loss) => {
    if (loss.reason === "parentGone") {
      return { ...describe(loss.entity, loss.id), reason: loss.reason };
    }
    const parent = describe(loss.parent.entity, loss.parent.id);
    return {
      ...describe(loss.entity, loss.id),
      label: `Added to ${parent.label} after it was deleted`,
      owner: parent.owner,
      reason: loss.reason,
    };
  });
  const changes: Change[] = stored.map(({ entity, row, change }) => ({
    ...describe(entity, row.id),
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

// --- Generated values after publishing (ADR 0012) ---

// D1 binds at most 100 parameters per statement.
const ID_CHUNK = 90;

/** Live's rows with these ids. */
const liveRows = Effect.fn("drafts.liveRows")(function* <T extends overlay.ContentTable>(
  ctx: ServiceContext,
  table: T,
  ids: Iterable<string>,
) {
  const all = [...ids];
  const rows: T["$inferSelect"][] = [];
  for (let start = 0; start < all.length; start += ID_CHUNK) {
    const chunk = all.slice(start, start + ID_CHUNK);
    rows.push(...(yield* overlay.select(ctx.db, null, table, inArray(table.id, chunk))));
  }
  return rows;
});

/**
 * Requests Live's generated values for everything a publish changed and the parents above it:
 * another draft may have published to the same page since this one generated its values.
 * Children are generated first, so their parents start from the new summaries.
 */
const requestLiveGeneration = Effect.fn("drafts.requestLiveGeneration")(function* (
  ctx: ServiceContext,
  scope: Scope,
  stored: overlay.StoredChange[],
) {
  const kept = stored.filter((change) => change.change !== "deleted");
  const ids = (table: overlay.ContentTable) =>
    new Set(kept.filter((change) => change.table === table).map((change) => change.row.id));
  const itemIds = ids(repeatableItems);
  const blockIds = ids(blocks);
  const pageIds = ids(pages);
  const fileIds = ids(files);

  // Live now holds what the draft published.
  const items = yield* liveRows(ctx, repeatableItems, itemIds);
  const placementOf = new Map<string, string | null>();
  for (const item of items) {
    const root = rootOfItem(item);
    if ("blockId" in root) {
      blockIds.add(root.blockId);
      continue;
    }
    const key = `${root.sharedContent.projectId}:${root.sharedContent.type}`;
    if (!placementOf.has(key)) {
      placementOf.set(key, yield* sharedPlacementId(ctx.db, null, root.sharedContent));
    }
    const placement = placementOf.get(key);
    if (placement) blockIds.add(placement);
  }
  for (const change of kept.filter((change) => change.table === sharedContents)) {
    const shared = change.row as typeof sharedContents.$inferSelect;
    const placement = yield* sharedPlacementId(ctx.db, null, shared);
    if (placement) blockIds.add(placement);
  }
  const blockRows = yield* liveRows(ctx, blocks, blockIds);
  for (const block of blockRows) if (block.pageId) pageIds.add(block.pageId);
  const pageRows = yield* liveRows(ctx, pages, pageIds);
  const fileRows = yield* liveRows(ctx, files, fileIds);

  const live = homeOf(null, scope.projectId);
  for (const item of items) {
    yield* requestGeneration(ctx, live, {
      entity: "repeatableItem",
      entityId: item.id,
      delayMs: 0,
    });
  }
  for (const block of blockRows) {
    yield* requestGeneration(ctx, live, { entity: "block", entityId: block.id, delayMs: 5000 });
  }
  for (const page of pageRows) yield* requestPageSeo(ctx, null, page, 15000);
  for (const file of fileRows) {
    if (!metadataGenerated(file)) continue;
    yield* requestGeneration(ctx, live, { entity: "file", entityId: file.id, delayMs: 0 });
  }
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
  // A development draft never ends: publishing and discarding empty it (ADR 0006).
  if (!ctx.draft || "development" in ctx.draft) return undefined;
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
      ["camox", "files"],
      ["camox", "blocks"],
      ["camox", "repeatableItems"],
      ["camox", "collections"],
      // Every draft's conflicts, and the list's latest publish and change counts.
      queryKeys.drafts.all,
    ],
  });

/** Switches the ended draft's viewers to Live, saying who ended it and how. */
const broadcastEnded = (ctx: ServiceContext, projectId: number, ended: EndedDraft | null) => {
  if (ended) broadcastDraftEnded({ ...roomOf(ctx, projectId), ended });
};

/** Refreshes every viewer's drafts list, which a discard changed. */
const broadcastDiscarded = (ctx: ServiceContext, projectId: number) =>
  broadcastInvalidation({
    ...roomOf(ctx, projectId),
    draftId: null,
    targets: [queryKeys.drafts.list],
  });

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
  // Collected before the batch drops the draft's rows and replaces Live's.
  const blobs = yield* blobsOfDraft(ctx.db, scope);
  const applied = yield* Effect.result(
    overlay.publish(ctx.db, scope, {
      shown,
      publishedBy: user.id,
      now: Date.now(),
      alongside: [
        ...draftComments.publishStatements(ctx.db, scope.id),
        ...generatedValueStatements.publishStatements(ctx.db, scope.id),
      ],
    }),
  );
  if (applied._tag === "Failure") {
    // A concurrent publish or discard may have ended the draft; otherwise Live changed.
    const ended = yield* findEndedDraft(ctx.db, projectId, scope.id);
    if (ended) return { ended };
    return yield* new ConflictsChangedError({
      message: "Live changed since the preview. Review the new preview before publishing.",
    });
  }

  yield* deleteUnreferencedBlobs(ctx, blobs);
  yield* requestLiveGeneration(ctx, scope, stored);
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
  // Collected before the cascade drops the draft's rows.
  const blobs = yield* blobsOfDraft(ctx.db, scope);
  const result = yield* Effect.result(
    overlay.discard(ctx.db, scope, {
      discardedBy: user.id,
      now: Date.now(),
      alongside: [
        ...draftComments.discardStatements(ctx.db, scope.id),
        ...generatedValueStatements.discardStatements(ctx.db, scope.id),
      ],
    }),
  );
  const ended = (yield* findEndedDraft(ctx.db, projectId, scope.id)) ?? null;
  if (result._tag === "Failure" && !ended) return yield* Effect.die(result.failure);
  if (result._tag === "Success") {
    yield* deleteUnreferencedBlobs(ctx, blobs);
    broadcastDiscarded(ctx, projectId);
    broadcastEnded(ctx, projectId, ended);
  }
  return { ended };
});
