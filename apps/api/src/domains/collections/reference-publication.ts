import { isQueryBacked } from "@camox/api-contract";
import { and, eq, sql } from "drizzle-orm";
import { Effect } from "effect";
import { z } from "zod";

import { assertLayoutAccess, assertPageAccess, requireUser } from "../../authorization";
import { broadcastInvalidation } from "../../lib/broadcast-invalidation";
import { ConflictError, decodeInput, InvalidInputError } from "../../lib/errors";
import { resolveEnvironment } from "../../lib/resolve-environment";
import { stableStringify } from "../../lib/stable-stringify";
import {
  blockDefinitions,
  layoutCheckpoints,
  layouts,
  pageCheckpoints,
  pages,
  projects,
} from "../../schema";
import type { ServiceContext } from "../_shared/service-context";
import { layoutNamed } from "../layouts/identity";
import { buildLayoutSnapshotFromDraft } from "../layouts/service";
import { buildPageSnapshotFromDraft } from "../pages/service";
import { collectionOfRecord } from "./identity";
import {
  collectionSelection,
  layoutReferenceTargetsInput,
  pageReferenceTargetsInput,
} from "./reference-publication-input";
import {
  itemSchemas,
  referencedRecords,
  referenceFields,
  referenceListFields,
  resolvedReference,
  resolvedReferenceList,
  resolveReferences,
  type ResolvedReference,
} from "./references";
import { collectionDefinitions, collectionRecords, collectionRevisions } from "./schema";
import { validateContent } from "./validation";
export {
  layoutReferenceTargetsInput,
  pageReferenceTargetsInput,
} from "./reference-publication-input";

type PublicationKind = "page" | "layout";
/** A page is found by its id; a layout by its name within a project. */
type TargetsInput<K extends PublicationKind> = K extends "page"
  ? z.input<typeof pageReferenceTargetsInput>
  : z.input<typeof layoutReferenceTargetsInput>;
type PublicationTarget =
  | ({ kind: "page" } & z.infer<typeof pageReferenceTargetsInput>)
  | ({ kind: "layout" } & z.infer<typeof layoutReferenceTargetsInput>);

const decodeTarget = Effect.fn("collections.decodeTarget")(function* (
  rawInput: unknown,
  kind: PublicationKind,
): Effect.fn.Return<PublicationTarget, InvalidInputError> {
  if (kind === "page") {
    return { kind, ...(yield* decodeInput(pageReferenceTargetsInput, rawInput)) };
  }
  return { kind, ...(yield* decodeInput(layoutReferenceTargetsInput, rawInput)) };
});

/** The layout a publication includes: the target layout, or the page's when asked for. */
const publishedLayout = Effect.fn("collections.publishedLayout")(function* (
  ctx: ServiceContext,
  target: PublicationTarget,
  page: typeof pages.$inferSelect | undefined,
  userId: string,
) {
  if (target.kind === "layout") {
    const environment = yield* resolveEnvironment(ctx.db, target.projectId, ctx.environmentName);
    const access = yield* assertLayoutAccess(
      ctx.db,
      { projectId: target.projectId, environmentId: environment.id, layoutId: target.layoutId },
      userId,
    );
    return access.layout;
  }
  if (!page || !target.alsoPublishLayout) return undefined;
  return yield* Effect.promise(() =>
    ctx.db.select().from(layouts).where(layoutNamed(page.environmentId, page.layoutId)).get(),
  );
});

const publicationScope = Effect.fn("collections.publicationScope")(function* (
  ctx: ServiceContext,
  target: PublicationTarget,
) {
  const user = yield* requireUser(ctx);
  const page =
    target.kind === "page" ? (yield* assertPageAccess(ctx.db, target.id, user.id)).page : undefined;
  const layout = yield* publishedLayout(ctx, target, page, user.id);
  const owner = page ?? layout!;
  // A record page can publish its record alone: the layout's blocks then leave the scope.
  const publishesLayout = !!layout && (target.kind === "page" || target.includeLayout !== false);
  const pageSnapshot = page ? yield* buildPageSnapshotFromDraft(ctx, page) : undefined;
  const layoutSnapshot =
    layout && publishesLayout ? yield* buildLayoutSnapshotFromDraft(ctx, layout) : undefined;
  return {
    page,
    layout,
    owner,
    pageRecord: target.kind === "layout" ? target.pageRecord : undefined,
    pageSnapshot,
    layoutSnapshot,
    blocks: [...(pageSnapshot?.blocks ?? []), ...(layoutSnapshot?.blocks ?? [])],
    items: [...(pageSnapshot?.repeatableItems ?? []), ...(layoutSnapshot?.repeatableItems ?? [])],
  };
});

type Target = {
  id: string;
  collectionId: string;
  label: string;
  expectedVersion: number;
  status: "draft" | "modified" | "published";
  required: boolean;
  hasPublishedRevision: boolean;
};

const plan = Effect.fn("collections.plan")(function* (
  ctx: ServiceContext,
  scope: Effect.Success<ReturnType<typeof publicationScope>>,
) {
  const definitions = yield* Effect.promise(() =>
    ctx.db
      .select()
      .from(blockDefinitions)
      .where(
        and(
          eq(blockDefinitions.projectId, scope.owner.projectId),
          eq(blockDefinitions.environmentId, scope.owner.environmentId),
        ),
      ),
  );
  const targets = new Map<string, Target>();
  const missingRequired: string[] = [];
  // Each record is one target however many placements link it; required wins.
  const draftRecords = new Map<string, ResolvedReference>();
  const addTarget = (
    record: ResolvedReference,
    live: ResolvedReference | undefined,
    required: boolean,
  ) => {
    const previous = targets.get(record.id);
    draftRecords.set(record.id, record);
    targets.set(record.id, {
      id: record.id,
      collectionId: record.collectionId,
      label: record.label,
      expectedVersion: record.version!,
      required: previous?.required === true || required,
      hasPublishedRevision: !!live,
      status: !live
        ? "draft"
        : stableStringify(record.content) === stableStringify(live.content)
          ? "published"
          : "modified",
    });
  };
  // Blocks and their repeatable items each place records through their own content schema.
  const placements: { path: string; schema: unknown; content: unknown }[] = [];
  for (const block of scope.blocks) {
    const schema = definitions.find(
      (definition) => definition.blockId === block.type,
    )?.contentSchema;
    placements.push({ path: String(block.id), schema, content: block.content });
    const items = scope.items.filter((item) => item.blockId === block.id);
    const schemas = itemSchemas(schema, items);
    for (const item of items) {
      placements.push({
        path: `${block.id}.${item.id}`,
        schema: schemas.get(item.id),
        content: item.content,
      });
    }
  }
  for (const placement of placements) {
    const { path, content } = placement;
    // Query results are resolved content the page does not own, so they are never publication
    // targets: query-backed lists are dropped before anything resolves.
    const schema = withoutQueryBackedLists(placement.schema);
    const draft = yield* resolveReferences(ctx, scope.owner, schema, content, "draft");
    const live = yield* resolveReferences(ctx, scope.owner, schema, content, "live");
    for (const [field, reference] of referenceFields(schema)) {
      const record = resolvedReference(draft, field);
      if (!record) {
        if (reference.required === true) missingRequired.push(`${path}.${field}`);
        continue;
      }
      addTarget(record, resolvedReference(live, field) ?? undefined, reference.required === true);
    }
    // List entries are never required: unpublished ones are skipped live.
    for (const [field] of referenceListFields(schema)) {
      const published = resolvedReferenceList(live, field);
      for (const record of resolvedReferenceList(draft, field)) {
        addTarget(
          record,
          published.find((candidate) => candidate.id === record.id),
          false,
        );
      }
    }
  }
  // A record page's record is an optional target like any linked record. It must belong to
  // the named collection in the layout's environment.
  if (scope.pageRecord) {
    const schema = {
      properties: {
        record: { fieldType: "Reference", collectionId: scope.pageRecord.collectionId },
      },
    };
    const content = { record: scope.pageRecord.id };
    const draft = yield* resolveReferences(ctx, scope.owner, schema, content, "draft");
    const record = resolvedReference(draft, "record");
    if (!record)
      return yield* new InvalidInputError({
        message: `Record "${scope.pageRecord.id}" isn't in collection "${scope.pageRecord.collectionId}" of this environment`,
      });
    const live = yield* resolveReferences(ctx, scope.owner, schema, content, "live");
    addTarget(record, resolvedReference(live, "record") ?? undefined, false);
  }
  // Records reached at the second hop (an article's author) are independent, never required
  // targets. Their live revision is looked up directly: the live first hop may not link them yet.
  const reached = [...targets.keys()].flatMap((id) => draftRecords.get(id) ?? []);
  for (const nested of reached.flatMap((record) => referencedRecords(record.references))) {
    if (targets.has(nested.id)) continue;
    const live = yield* resolveReferences(
      ctx,
      scope.owner,
      { properties: { record: { fieldType: "Reference", collectionId: nested.collectionId } } },
      { record: nested.id },
      "live",
      2,
    );
    addTarget(nested, resolvedReference(live, "record") ?? undefined, false);
  }
  return { targets: [...targets.values()], missingRequired };
});

/** A content schema without its query-backed reference lists. */
function withoutQueryBackedLists(schema: unknown) {
  const properties = (schema as { properties?: Record<string, object> } | null)?.properties;
  if (!properties) return schema;
  return {
    ...(schema as object),
    properties: Object.fromEntries(
      Object.entries(properties).filter(([, field]) => !isQueryBacked(field)),
    ),
  };
}

export const referenceTargets = Effect.fn("collections.referenceTargets")(function* <
  K extends PublicationKind,
>(ctx: ServiceContext, rawInput: TargetsInput<K>, kind: K) {
  const target = yield* decodeTarget(rawInput, kind);
  return yield* plan(ctx, yield* publicationScope(ctx, target));
});

/**
 * Immutable snapshots may be orphaned on conflict. All visible pointers (including * independently published synced blocks) move in one D1 batch, never as a sequence of publications.
 */
export const publishWithReferences = Effect.fn("collections.publishWithReferences")(function* <
  K extends PublicationKind,
>(
  ctx: ServiceContext,
  input: TargetsInput<K> & { collections: z.infer<typeof collectionSelection> },
  kind: K,
) {
  const target = yield* decodeTarget(input, kind);
  const scope = yield* publicationScope(ctx, target);
  const review = yield* plan(ctx, scope);
  if (review.missingRequired.length)
    return yield* new ConflictError({
      message: `Select required references before publishing: ${review.missingRequired.join(", ")}`,
    });
  const selected = new Map(input.collections.map((selection) => [selection.id, selection]));
  if (selected.size !== input.collections.length)
    return yield* new InvalidInputError({ message: "Duplicate publication targets" });
  for (const selection of selected.values()) {
    const target = review.targets.find(
      (target) => target.id === selection.id && target.collectionId === selection.collectionId,
    );
    if (!target || target.expectedVersion !== selection.expectedVersion)
      return yield* new ConflictError({
        message: "Reference publication plan changed; review again",
      });
  }
  for (const target of review.targets) {
    if (target.required && !target.hasPublishedRevision && !selected.has(target.id)) {
      return yield* new ConflictError({
        message: `Required item "${target.label}" must be included in publication`,
      });
    }
  }
  const now = Date.now();
  const statements: Parameters<typeof ctx.db.batch>[0][number][] = [];
  const ownerPointers: Parameters<typeof ctx.db.batch>[0][number][] = [];
  for (const selection of selected.values()) {
    statements.push(
      ctx.db
        .select({
          valid: sql<number>`case when exists (
      select 1 from ${collectionRecords} r join ${collectionDefinitions} d
        on d.environment_id = r.environment_id and d.collection_id = r.collection_id
      where r.id = ${selection.id} and r.version = ${selection.expectedVersion}
        and d.active = 1 and d.project_id = ${scope.owner.projectId}
        and d.environment_id = ${scope.owner.environmentId} and d.collection_id = ${selection.collectionId}
    ) then 1 else json('reference publication conflict') end`,
        })
        .from(projects)
        .where(eq(projects.id, scope.owner.projectId)),
    );
  }
  for (const selection of selected.values()) {
    const found = yield* Effect.promise(() =>
      ctx.db
        .select({ record: collectionRecords, definition: collectionDefinitions })
        .from(collectionRecords)
        .innerJoin(collectionDefinitions, collectionOfRecord)
        .where(eq(collectionRecords.id, selection.id))
        .get(),
    );
    const record = found?.record;
    const definition = found?.definition;
    if (!record || !definition || record.version !== selection.expectedVersion)
      return yield* new ConflictError({
        message: "Reference publication plan changed; review again",
      });
    yield* validateContent(ctx, definition, record.draft);
    const revision = yield* Effect.promise(() =>
      ctx.db
        .insert(collectionRevisions)
        .values({
          id: crypto.randomUUID(),
          recordId: record.id,
          content: record.draft,
          definition,
          kind: "auto-publish",
          createdBy: ctx.user!.id,
          createdAt: now,
        })
        .returning()
        .get(),
    );
    // A failed optimistic check must abort the batch, not silently skip one pointer.
    statements.push(
      ctx.db
        .update(collectionRecords)
        .set({
          publishedRevisionId: sql`case when ${collectionRecords.version} = ${selection.expectedVersion} then ${revision.id} else json('reference publication conflict') end`,
          version: sql`${collectionRecords.version} + 1`,
          updatedAt: now,
        })
        .where(eq(collectionRecords.id, record.id)),
    );
  }
  const { page, layout } = scope;
  if (page && scope.pageSnapshot) {
    const checkpoint = yield* Effect.promise(() =>
      ctx.db
        .insert(pageCheckpoints)
        .values({
          pageId: page.id,
          kind: "auto-publish",
          label: null,
          snapshot: JSON.stringify(scope.pageSnapshot),
          schemaVersion: 1,
          createdAt: now,
          createdBy: ctx.user!.id,
        })
        .returning()
        .get(),
    );
    ownerPointers.push(
      ctx.db
        .update(pages)
        .set({ livePublishedCheckpointId: checkpoint.id, updatedAt: now })
        .where(eq(pages.id, page.id)),
    );
  }
  if (layout && scope.layoutSnapshot) {
    const checkpoint = yield* Effect.promise(() =>
      ctx.db
        .insert(layoutCheckpoints)
        .values({
          environmentId: layout.environmentId,
          layoutId: layout.layoutId,
          kind: "auto-publish",
          label: null,
          snapshot: JSON.stringify(scope.layoutSnapshot),
          schemaVersion: 1,
          createdAt: now,
          createdBy: ctx.user!.id,
        })
        .returning()
        .get(),
    );
    ownerPointers.push(
      ctx.db
        .update(layouts)
        .set({ livePublishedCheckpointId: checkpoint.id, updatedAt: now })
        .where(layoutNamed(layout.environmentId, layout.layoutId)),
    );
  }
  const seen = new Set<string>();
  for (const snapshot of [scope.pageSnapshot, scope.layoutSnapshot]) {
    for (const block of snapshot?.blocks ?? []) {
      if (seen.has(block.type)) continue;
      seen.add(block.type);
      statements.push(
        ctx.db
          .update(blockDefinitions)
          .set({
            syncedPublishedData: {
              block,
              items: snapshot!.repeatableItems.filter((item) => item.blockId === block.id),
            },
          })
          .where(
            and(
              eq(blockDefinitions.environmentId, scope.owner.environmentId),
              eq(blockDefinitions.blockId, block.type),
              eq(blockDefinitions.synced, true),
            ),
          ),
      );
    }
  }
  // Effective live dependencies overlay shared data. Repair shared pointers before
  // owner pointers so their guards never inspect the displaced shared revision.
  statements.push(...ownerPointers);
  const publicationFailed = new ConflictError({
    message: "Publication changed or failed; reload before retrying",
  });
  if (!statements.length) return yield* publicationFailed;
  yield* Effect.tryPromise({
    try: () => ctx.db.batch([statements[0], ...statements.slice(1)]),
    catch: () => publicationFailed,
  });
  broadcastInvalidation({
    waitUntil: ctx.waitUntil,
    projectRoomNamespace: ctx.env.ProjectRoom,
    projectId: scope.owner.projectId,
    targets: [
      ["camox", "blocks"],
      ["camox", "pages"],
      ["camox", "layouts"],
      ["camox", "collections"],
    ],
  });
  if (scope.page && target.kind === "page") {
    const pageId = scope.page.id;
    return yield* Effect.promise(() =>
      ctx.db.select().from(pages).where(eq(pages.id, pageId)).get(),
    );
  }
  const { environmentId, layoutId } = scope.owner as typeof layouts.$inferSelect;
  return yield* Effect.promise(() =>
    ctx.db.select().from(layouts).where(layoutNamed(environmentId, layoutId)).get(),
  );
});
