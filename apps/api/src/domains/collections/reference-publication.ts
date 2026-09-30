import { ORPCError } from "@orpc/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { assertLayoutAccess, assertPageAccess } from "../../authorization";
import { broadcastInvalidation } from "../../lib/broadcast-invalidation";
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

async function publicationScope(
  ctx: ServiceContext,
  input: z.infer<typeof referenceTargetsInput>,
  kind: "page" | "layout",
) {
  if (!ctx.user) throw new ORPCError("UNAUTHORIZED");
  const pageAccess = kind === "page" ? await assertPageAccess(ctx.db, input.id, ctx.user.id) : null;
  const layoutAccess =
    kind === "layout" ? await assertLayoutAccess(ctx.db, input.id, ctx.user.id) : null;
  if (!pageAccess && !layoutAccess) throw new ORPCError("NOT_FOUND");
  const page = pageAccess?.page;
  const layout =
    layoutAccess?.layout ??
    (input.alsoPublishLayout && page?.layoutId
      ? await ctx.db.select().from(layouts).where(eq(layouts.id, page.layoutId)).get()
      : undefined);
  const owner = page ?? layout!;
  const pageSnapshot = page ? await buildPageSnapshotFromDraft(ctx, page) : undefined;
  const layoutSnapshot = layout ? await buildLayoutSnapshotFromDraft(ctx, layout) : undefined;
  return {
    page,
    layout,
    owner,
    pageSnapshot,
    layoutSnapshot,
    blocks: [...(pageSnapshot?.blocks ?? []), ...(layoutSnapshot?.blocks ?? [])],
  };
}

type Target = {
  id: string;
  collectionId: string;
  label: string;
  expectedVersion: number;
  status: "draft" | "modified" | "published";
  required: boolean;
  hasPublishedRevision: boolean;
};

async function plan(ctx: ServiceContext, scope: Awaited<ReturnType<typeof publicationScope>>) {
  const definitions = await ctx.db
    .select()
    .from(blockDefinitions)
    .where(
      and(
        eq(blockDefinitions.projectId, scope.owner.projectId),
        eq(blockDefinitions.environmentId, scope.owner.environmentId),
      ),
    );
  const targets = new Map<string, Target>();
  const missingRequired: string[] = [];
  for (const block of scope.blocks) {
    const schema = definitions.find(
      (definition) => definition.blockId === block.type,
    )?.contentSchema;
    const draft = await resolveReferences(ctx, scope.owner, schema, block.content, "draft");
    const live = await resolveReferences(ctx, scope.owner, schema, block.content, "live");
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
}

export async function referenceTargets(
  ctx: ServiceContext,
  input: z.input<typeof referenceTargetsInput>,
  kind: "page" | "layout",
) {
  return plan(ctx, await publicationScope(ctx, referenceTargetsInput.parse(input), kind));
}

/**
 * Immutable snapshots may be orphaned on conflict. All visible pointers (including
 * independently shared blocks) move in one D1 batch, never as a sequence of publications.
 */
export async function publishWithReferences(
  ctx: ServiceContext,
  input: z.infer<typeof referenceTargetsInput> & {
    collections: z.infer<typeof collectionSelection>;
  },
  kind: "page" | "layout",
) {
  const scope = await publicationScope(ctx, input, kind);
  const review = await plan(ctx, scope);
  if (review.missingRequired.length)
    throw new ORPCError("CONFLICT", {
      message: `Select required references before publishing: ${review.missingRequired.join(", ")}`,
    });
  const selected = new Map(input.collections.map((selection) => [selection.id, selection]));
  if (selected.size !== input.collections.length)
    throw new ORPCError("BAD_REQUEST", { message: "Duplicate publication targets" });
  for (const selection of selected.values()) {
    const target = review.targets.find(
      (target) => target.id === selection.id && target.collectionId === selection.collectionId,
    );
    if (!target || target.expectedVersion !== selection.expectedVersion)
      throw new ORPCError("CONFLICT", {
        message: "Reference publication plan changed; review again",
      });
  }
  for (const target of review.targets) {
    if (target.required && !target.hasPublishedRevision && !selected.has(target.id)) {
      throw new ORPCError("CONFLICT", {
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
    const record = await ctx.db
      .select()
      .from(collectionRecords)
      .where(eq(collectionRecords.id, selection.id))
      .get();
    const definition =
      record &&
      (await ctx.db
        .select()
        .from(collectionDefinitions)
        .where(eq(collectionDefinitions.id, record.definitionId))
        .get());
    if (!record || !definition || record.version !== selection.expectedVersion)
      throw new ORPCError("CONFLICT");
    await validateContent(ctx, definition, record.draft);
    const revision = await ctx.db
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
      .get();
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
  if (scope.page && scope.pageSnapshot) {
    const checkpoint = await ctx.db
      .insert(pageCheckpoints)
      .values({
        pageId: scope.page.id,
        kind: "auto-publish",
        label: null,
        snapshot: JSON.stringify(scope.pageSnapshot),
        schemaVersion: 1,
        createdAt: now,
        createdBy: ctx.user!.id,
      })
      .returning()
      .get();
    ownerPointers.push(
      ctx.db
        .update(pages)
        .set({ livePublishedCheckpointId: checkpoint.id, updatedAt: now })
        .where(eq(pages.id, scope.page.id)),
    );
  }
  if (scope.layout && scope.layoutSnapshot) {
    const checkpoint = await ctx.db
      .insert(layoutCheckpoints)
      .values({
        layoutId: scope.layout.id,
        kind: "auto-publish",
        label: null,
        snapshot: JSON.stringify(scope.layoutSnapshot),
        schemaVersion: 1,
        createdAt: now,
        createdBy: ctx.user!.id,
      })
      .returning()
      .get();
    ownerPointers.push(
      ctx.db
        .update(layouts)
        .set({ livePublishedCheckpointId: checkpoint.id, updatedAt: now })
        .where(eq(layouts.id, scope.layout.id)),
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
  try {
    if (!statements.length) throw new ORPCError("BAD_REQUEST");
    await ctx.db.batch([statements[0], ...statements.slice(1)]);
  } catch (cause) {
    throw new ORPCError("CONFLICT", {
      message: "Publication changed or failed; reload before retrying",
      cause,
    });
  }
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
  return kind === "page"
    ? ctx.db.select().from(pages).where(eq(pages.id, input.id)).get()
    : ctx.db.select().from(layouts).where(eq(layouts.id, input.id)).get();
}
