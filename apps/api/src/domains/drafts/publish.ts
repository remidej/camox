import type { EndedDraft } from "@camox/api-contract/drafts";
import { queryKeys } from "@camox/api-contract/query-keys";
import { and, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";
import { z } from "zod";

import { requireUser } from "../../authorization";
import { broadcastDraftEnded, broadcastInvalidation } from "../../lib/broadcast-invalidation";
import {
  ConflictsChangedError,
  decodeInput,
  InvalidInputError,
  PublishBlockedError,
} from "../../lib/errors";
import {
  blockDefinitions,
  blocks,
  collectionDefinitions,
  collectionRecords,
  files,
  layouts,
  pages,
  repeatableItems,
  sharedContents,
} from "../../schema";
import { definitionsIn } from "../_shared/definitions";
import type { ServiceContext } from "../_shared/service-context";
import { user as users } from "../auth/schema";
import { sharedPlacementId } from "../blocks/shared-content";
import { metadataGenerated, withFileMetadata } from "../files/generated-metadata";
import { checkFileProblems, type FileProblemCode, type Finding } from "../files/publish-checks";
import { blobsOfDraft, deleteUnreferencedBlobs } from "../files/service";
import * as generatedValueStatements from "../generated-values/service";
import { homeOf, requestGeneration } from "../generated-values/service";
import { deleteUnreferencedOgImageBlobs, ogImageBlobsOf } from "../pages/og-image-blobs";
import { requestPageSeo } from "../pages/service";
import { rootOfItem } from "../repeatable-items/roots";
import { accessTo } from "./access";
import {
  checkContentProblems,
  type ContentFinding,
  type ContentProblemCode,
} from "./content-checks";
import * as overlay from "./overlay";
import type { DraftScope } from "./scope";
import { findEndedDraft } from "./service";
import { describeSubjects, type RecordRow, type Subject } from "./subjects";

export type { Owner, Subject, SubjectKind } from "./subjects";

// Publishing a draft and discarding it (ADR 0009). The preview lists what publishing will do;
// its token records the conflicts it showed, and publishing aborts when they've changed since.

type Scope = NonNullable<DraftScope>;
type FileRow = typeof files.$inferSelect;

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
  code: "definitionsDiffer" | FileProblemCode | ContentProblemCode;
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

const tokenSchema = z.array(
  z.tuple([z.enum(overlay.ENTITY_KINDS), z.string(), z.number().nullable()]),
);

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
  const checked = yield* checkContentProblems(ctx, scope);
  const fileChecks = yield* checkFileProblems(ctx, scope, checked.holders);
  const findings = [
    ...fileChecks.blockers,
    ...fileChecks.warnings,
    ...checked.blockers,
    ...checked.warnings,
  ];

  const changedFiles = yield* withFileMetadata(
    ctx.db,
    scope,
    stored.flatMap((change) => (change.entity === "file" ? [change.row as FileRow] : [])),
  );
  const describe = yield* describeSubjects(
    ctx,
    scope,
    [
      ...stored.map(({ entity, row }) => ({ entity, id: row.id })),
      ...storedConflicts,
      ...losses.flatMap((loss) => (loss.reason === "parentGone" ? [loss] : [loss, loss.parent])),
      ...findings,
    ],
    {
      records: [
        ...checked.records,
        ...stored.flatMap((change) =>
          change.table === collectionRecords ? [change.row as RecordRow] : [],
        ),
      ],
      files: new Map([
        ...fileChecks.files,
        ...changedFiles.map((file) => [file.id, file] as const),
      ]),
    },
  );
  const asProblem = ({ entity, id, code, field, message }: ContentFinding | Finding): Problem => ({
    ...describe(entity, id),
    code,
    field,
    message,
  });

  const blockers = [
    ...(yield* checkDefinitions(ctx, scope)),
    ...fileChecks.blockers.map(asProblem),
    ...checked.blockers.map(asProblem),
  ];
  const warnings = [...fileChecks.warnings.map(asProblem), ...checked.warnings.map(asProblem)];

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
  const { scope } = yield* Effect.scoped(accessTo(ctx, { project: projectId }, "member"));
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
 * The draft a request names, or how it ended when an earlier attempt published or discarded
 * it, so a retried publish or discard reports that instead of applying anything again.
 */
const draftOrEnded = (ctx: ServiceContext, projectId: number) =>
  requireDraft(ctx, projectId).pipe(
    Effect.map((draft) => ({ draft, ended: null })),
    Effect.catchTag("DraftEndedError", ({ ended }) => Effect.succeed({ draft: null, ended })),
  );

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
 * What publishing did: nothing, for an empty draft, which publishing leaves as is; or how the
 * draft ended, also when an earlier attempt ended it (null for a development draft, which stays
 * open, emptied).
 */
export type PublishResult =
  | { empty: true; ended: null }
  | { empty: false; ended: EndedDraft | null };

const nothingToPublish: PublishResult = { empty: true, ended: null };
const endedAs = (ended: EndedDraft | null): PublishResult => ({ empty: false, ended });

/**
 * Publishes the request's draft whole, once it has no blockers, if its conflicts are still
 * those the token was given for.
 */
export const publishDraft = Effect.fn("drafts.publishDraft")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof publishInput>,
) {
  const { projectId, token } = yield* decodeInput(publishInput, rawInput);
  const { draft: scope, ended: earlier } = yield* draftOrEnded(ctx, projectId);
  if (!scope) return endedAs(earlier);
  const shown = yield* decodeToken(token);
  const stored = yield* overlay.changesOf(ctx.db, scope);
  if (stored.length === 0) return nothingToPublish;

  const preview = yield* computePreview(ctx, scope);
  if (preview.blockers.length > 0) {
    return yield* new PublishBlockedError({
      message: `The draft has ${preview.blockers.length} blocker(s) to fix before publishing`,
    });
  }

  const user = yield* requireUser(ctx);
  // Collected before the batch drops the draft's rows and replaces Live's.
  const blobs = yield* blobsOfDraft(ctx.db, scope);
  const ogImageBlobs = yield* ogImageBlobsOf(ctx.db, projectId);
  const applied = yield* Effect.result(
    overlay.publish(ctx.db, scope, {
      shown,
      publishedBy: user.id,
      now: Date.now(),
      after: generatedValueStatements.publishStatements(ctx.db, scope),
    }),
  );
  if (applied._tag === "Failure") {
    // A concurrent publish or discard may have ended the draft; otherwise Live changed.
    const ended = yield* findEndedDraft(ctx.db, projectId, scope.id);
    if (ended) return endedAs(ended);
    return yield* new ConflictsChangedError({
      message: "Live changed since the preview. Review the new preview before publishing.",
    });
  }

  yield* deleteUnreferencedBlobs(ctx, blobs);
  yield* deleteUnreferencedOgImageBlobs(ctx, ogImageBlobs);
  yield* requestLiveGeneration(ctx, scope, stored);
  broadcastPublished(ctx, projectId);
  const ended = (yield* findEndedDraft(ctx.db, projectId, scope.id)) ?? null;
  broadcastEnded(ctx, projectId, ended);
  return endedAs(ended);
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
  const { draft: scope, ended: earlier } = yield* draftOrEnded(ctx, projectId);
  if (!scope) return { ended: earlier as EndedDraft | null };
  const user = yield* requireUser(ctx);
  // Collected before the cascade drops the draft's rows.
  const blobs = yield* blobsOfDraft(ctx.db, scope);
  const ogImageBlobs = yield* ogImageBlobsOf(ctx.db, projectId);
  const result = yield* Effect.result(
    overlay.discard(ctx.db, scope, {
      discardedBy: user.id,
      now: Date.now(),
      alongside: generatedValueStatements.discardStatements(ctx.db, scope.id),
    }),
  );
  const ended = (yield* findEndedDraft(ctx.db, projectId, scope.id)) ?? null;
  if (result._tag === "Failure" && !ended) return yield* Effect.die(result.failure);
  if (result._tag === "Success") {
    yield* deleteUnreferencedBlobs(ctx, blobs);
    yield* deleteUnreferencedOgImageBlobs(ctx, ogImageBlobs);
    broadcastDiscarded(ctx, projectId);
    broadcastEnded(ctx, projectId, ended);
  }
  return { ended };
});
