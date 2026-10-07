import { and, eq, sql } from "drizzle-orm";
import { Effect } from "effect";
import { z } from "zod";

import { assertLayoutAccess, assertPageAccess, requireUser } from "../../authorization";
import { broadcastInvalidation } from "../../lib/broadcast-invalidation";
import { ConflictError, decodeInput, InvalidInputError } from "../../lib/errors";
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
import { buildLayoutSnapshotFromDraft } from "../layouts/service";
import { buildPageSnapshotFromDraft } from "../pages/service";
import { collectionSelection, referenceTargetsInput } from "./reference-publication-input";
import { referenceFields, resolveReferences } from "./references";
import { collectionDefinitions, collectionRecords, collectionRevisions } from "./schema";
import { validateContent } from "./validation";
export { referenceTargetsInput } from "./reference-publication-input";

const publicationScope = Effect.fn("collections.publicationScope")(function* (
  ctx: ServiceContext,
  input: z.infer<typeof referenceTargetsInput>,
  kind: "page" | "layout",
) {
  const user = yield* requireUser(ctx);
  const pageAccess = kind === "page" ? yield* assertPageAccess(ctx.db, input.id, user.id) : null;
  const layoutAccess =
    kind === "layout" ? yield* assertLayoutAccess(ctx.db, input.id, user.id) : null;
  const page = pageAccess?.page;
  const layoutId = page?.layoutId;
  const layout =
    layoutAccess?.layout ??
    (input.alsoPublishLayout && layoutId
      ? yield* Effect.promise(() =>
          ctx.db.select().from(layouts).where(eq(layouts.id, layoutId)).get(),
        )
      : undefined);
  const owner = page ?? layout!;
  const pageSnapshot = page ? yield* buildPageSnapshotFromDraft(ctx, page) : undefined;
  const layoutSnapshot = layout ? yield* buildLayoutSnapshotFromDraft(ctx, layout) : undefined;
  return {
    page,
    layout,
    owner,
    pageSnapshot,
    layoutSnapshot,
    blocks: [...(pageSnapshot?.blocks ?? []), ...(layoutSnapshot?.blocks ?? [])],
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
  for (const block of scope.blocks) {
    const schema = definitions.find(
      (definition) => definition.blockId === block.type,
    )?.contentSchema;
    const draft = yield* resolveReferences(ctx, scope.owner, schema, block.content, "draft");
    const live = yield* resolveReferences(ctx, scope.owner, schema, block.content, "live");
    for (const [field, reference] of referenceFields(schema)) {
      const record = draft[field];
      if (!record) {
        if (reference.required === true) missingRequired.push(`${block.id}.${field}`);
        continue;
      }
      const previous = targets.get(record.id);
      targets.set(record.id, {
        id: record.id,
        collectionId: record.collectionId,
        label: record.label,
        expectedVersion: record.version!,
        required: previous?.required === true || reference.required === true,
        hasPublishedRevision: !!live[field],
        status: !live[field]
          ? "draft"
          : stableStringify(record.content) === stableStringify(live[field]!.content)
            ? "published"
            : "modified",
      });
    }
  }
  return { targets: [...targets.values()], missingRequired };
});

export const referenceTargets = Effect.fn("collections.referenceTargets")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof referenceTargetsInput>,
  kind: "page" | "layout",
) {
  const input = yield* decodeInput(referenceTargetsInput, rawInput);
  return yield* plan(ctx, yield* publicationScope(ctx, input, kind));
});

/**
 * Immutable snapshots may be orphaned on conflict. All visible pointers (including
 * independently shared blocks) move in one D1 batch, never as a sequence of publications.
 */
export const publishWithReferences = Effect.fn("collections.publishWithReferences")(function* (
  ctx: ServiceContext,
  input: z.infer<typeof referenceTargetsInput> & {
    collections: z.infer<typeof collectionSelection>;
  },
  kind: "page" | "layout",
) {
  const scope = yield* publicationScope(ctx, input, kind);
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
      select 1 from ${collectionRecords} r join ${collectionDefinitions} d on d.id = r.definition_id
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
    const record = yield* Effect.promise(() =>
      ctx.db.select().from(collectionRecords).where(eq(collectionRecords.id, selection.id)).get(),
    );
    const definitionId = record?.definitionId;
    const definition =
      definitionId === undefined
        ? undefined
        : yield* Effect.promise(() =>
            ctx.db
              .select()
              .from(collectionDefinitions)
              .where(eq(collectionDefinitions.id, definitionId))
              .get(),
          );
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
          layoutId: layout.id,
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
        .where(eq(layouts.id, layout.id)),
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
  if (kind === "page") {
    return yield* Effect.promise(() =>
      ctx.db.select().from(pages).where(eq(pages.id, input.id)).get(),
    );
  }
  return yield* Effect.promise(() =>
    ctx.db.select().from(layouts).where(eq(layouts.id, input.id)).get(),
  );
});
