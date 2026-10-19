import { and, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";
import { generateKeyBetween } from "fractional-indexing";
import { z } from "zod";

import {
  assertOrgMembership,
  assertSyncAccess,
  getAuthorizedProject,
  requireUser,
} from "../../authorization";
import { ConflictError, decodeInput, InvalidInputError, NotFoundError } from "../../lib/errors";
import { record } from "../../lib/journal";
import {
  blockDefinitions,
  collectionDefinitions,
  collectionRecords,
  blocks,
  files,
  generatedValues,
  layouts,
  locales,
  organizationTable,
  pages,
  projects,
  repeatableItems,
  sharedContents,
} from "../../schema";
import { definitionsIn } from "../_shared/definitions";
import { type Field, fieldsOf, pointersOf } from "../_shared/fields";
import type { ServiceContext } from "../_shared/service-context";
import { prepareBlockContent } from "../blocks/prepare-content";
import { adoptSharedContent } from "../blocks/shared-content";
import { validateReferenceValues } from "../collections/references";
import * as overlay from "../drafts/overlay";
import { visibleIn } from "../drafts/overlay";
import type { WriteTarget } from "../drafts/scope";
import { optimizedVideoKey } from "../files/video-optimization";
import { requestGeneration } from "../generated-values/generation";
import { homeOf } from "../generated-values/service";
import { insertInitialLocale } from "../locales/service";
import { itemsInProject } from "../repeatable-items/roots";
import { analyticsColumns, analyticsOf, analyticsProvidersInput } from "./analytics";

// --- Input Schemas ---
// Exported so adapters (oRPC, MCP, CLI) share the same canonical contract.
// Services .parse() them on entry — service is the trust boundary.

export const listProjectsInput = z.object({ organizationId: z.string() });
export const getFirstProjectInput = z.object({ organizationId: z.string() });
export const getProjectBySlugInput = z.object({ slug: z.string() });
export const getProjectInput = z.object({ id: z.number() });
export const checkProjectSlugAvailabilityInput = z.object({ slug: z.string() });
export const createProjectInput = z.object({
  name: z.string(),
  slug: z.string(),
  organizationId: z.string(),
});
export const updateProjectInput = z.object({ id: z.number(), name: z.string() });
export const deleteProjectInput = z.object({ id: z.number() });
export const updateProjectAnalyticsInput = analyticsProvidersInput.extend({ id: z.number() });

const repeatableItemSeedSchema = z.object({
  tempId: z.string(),
  parentTempId: z.string().nullable(),
  fieldName: z.string(),
  content: z.unknown(),
  settings: z.unknown().optional(),
  position: z.string(),
});

export const initializeProjectContentInput = z.object({
  projectSlug: z.string(),
  deployToken: z.string().optional(),
  layoutId: z.string(),
  blocks: z.array(
    z.object({
      type: z.string(),
      content: z.unknown(),
      settings: z.unknown().optional(),
      repeatableItems: z.array(repeatableItemSeedSchema).optional(),
    }),
  ),
});

// --- Reads ---

export const listProjects = Effect.fn("projects.listProjects")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof listProjectsInput>,
) {
  const user = yield* requireUser(ctx);
  const { organizationId } = yield* decodeInput(listProjectsInput, rawInput);
  yield* assertOrgMembership(ctx.db, user.id, organizationId);
  return yield* Effect.promise(() =>
    ctx.db.select().from(projects).where(eq(projects.organizationId, organizationId)),
  );
});

export const getFirstProject = Effect.fn("projects.getFirstProject")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof getFirstProjectInput>,
) {
  const user = yield* requireUser(ctx);
  const { organizationId } = yield* decodeInput(getFirstProjectInput, rawInput);
  yield* assertOrgMembership(ctx.db, user.id, organizationId);
  const result = yield* Effect.promise(() =>
    ctx.db
      .select()
      .from(projects)
      .where(eq(projects.organizationId, organizationId))
      .limit(1)
      .get(),
  );
  if (!result) return yield* new NotFoundError();
  return result;
});

export const getProjectBySlug = Effect.fn("projects.getProjectBySlug")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof getProjectBySlugInput>,
) {
  const user = yield* requireUser(ctx);
  const { slug } = yield* decodeInput(getProjectBySlugInput, rawInput);
  const result = yield* Effect.promise(() =>
    ctx.db
      .select({
        project: projects,
        organizationSlug: organizationTable.slug,
      })
      .from(projects)
      .innerJoin(organizationTable, eq(organizationTable.id, projects.organizationId))
      .where(eq(projects.slug, slug))
      .get(),
  );
  if (!result) return yield* new NotFoundError();
  yield* assertOrgMembership(ctx.db, user.id, result.project.organizationId);
  return {
    ...result.project,
    organizationSlug: result.organizationSlug,
    analytics: analyticsOf(result.project),
  };
});

export const getProject = Effect.fn("projects.getProject")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof getProjectInput>,
) {
  const user = yield* requireUser(ctx);
  const { id } = yield* decodeInput(getProjectInput, rawInput);
  const result = yield* Effect.promise(() =>
    ctx.db
      .select({
        project: projects,
        organizationSlug: organizationTable.slug,
      })
      .from(projects)
      .innerJoin(organizationTable, eq(organizationTable.id, projects.organizationId))
      .where(eq(projects.id, id))
      .get(),
  );
  if (!result) return yield* new NotFoundError();
  yield* assertOrgMembership(ctx.db, user.id, result.project.organizationId);
  return {
    ...result.project,
    organizationSlug: result.organizationSlug,
    analytics: analyticsOf(result.project),
  };
});

export const checkProjectSlugAvailability = Effect.fn("projects.checkProjectSlugAvailability")(
  function* (ctx: ServiceContext, rawInput: z.input<typeof checkProjectSlugAvailabilityInput>) {
    yield* requireUser(ctx);
    const { slug } = yield* decodeInput(checkProjectSlugAvailabilityInput, rawInput);
    const existing = yield* Effect.promise(() =>
      ctx.db.select({ id: projects.id }).from(projects).where(eq(projects.slug, slug)).get(),
    );
    return { available: !existing };
  },
);

// --- Writes ---

export const createProject = Effect.fn("projects.createProject")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof createProjectInput>,
) {
  const user = yield* requireUser(ctx);
  const input = yield* decodeInput(createProjectInput, rawInput);
  yield* assertOrgMembership(ctx.db, user.id, input.organizationId);

  // Race condition guard: check slug uniqueness at insert time
  const existing = yield* Effect.promise(() =>
    ctx.db.select({ id: projects.id }).from(projects).where(eq(projects.slug, input.slug)).get(),
  );
  if (existing) {
    return yield* new ConflictError({ message: "Slug is already taken" });
  }

  const deployToken = crypto.randomUUID();
  const now = Date.now();

  const result = yield* Effect.promise(() =>
    ctx.db
      .insert(projects)
      .values({
        name: input.name,
        slug: input.slug,
        deployToken,
        organizationId: input.organizationId,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get(),
  );

  yield* Effect.promise(() => insertInitialLocale(ctx.db, result.id, now));

  return result;
});

export const updateProject = Effect.fn("projects.updateProject")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof updateProjectInput>,
) {
  const user = yield* requireUser(ctx);
  const { id, ...body } = yield* decodeInput(updateProjectInput, rawInput);
  yield* getAuthorizedProject(ctx.db, id, user.id);
  const result = yield* Effect.promise(() =>
    ctx.db
      .update(projects)
      .set({ ...body, updatedAt: Date.now() })
      .where(eq(projects.id, id))
      .returning()
      .get(),
  );
  yield* record(ctx.db, { kind: "project", projectId: id });
  return result;
});

/** Sets or removes analytics providers: a Project Setting, so Live and every draft change at once. */
export const updateProjectAnalytics = Effect.fn("projects.updateProjectAnalytics")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof updateProjectAnalyticsInput>,
) {
  const user = yield* requireUser(ctx);
  const { id, ...providers } = yield* decodeInput(updateProjectAnalyticsInput, rawInput);
  yield* getAuthorizedProject(ctx.db, id, user.id);
  const result = yield* Effect.promise(() =>
    ctx.db
      .update(projects)
      .set({ ...analyticsColumns(providers), updatedAt: Date.now() })
      .where(eq(projects.id, id))
      .returning()
      .get(),
  );
  yield* record(ctx.db, { kind: "project", projectId: id });
  return { analytics: analyticsOf(result), updatedAt: result.updatedAt };
});

export const deleteProject = Effect.fn("projects.deleteProject")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof deleteProjectInput>,
) {
  const user = yield* requireUser(ctx);
  const { id } = yield* decodeInput(deleteProjectInput, rawInput);
  const project = yield* getAuthorizedProject(ctx.db, id, user.id);

  const projectId = project.id;

  const collection = yield* Effect.promise(() =>
    ctx.db
      .select({ id: collectionRecords.id })
      .from(collectionRecords)
      .innerJoin(
        collectionDefinitions,
        and(
          eq(collectionDefinitions.projectId, collectionRecords.projectId),
          eq(collectionDefinitions.collectionId, collectionRecords.collectionId),
        ),
      )
      .where(eq(collectionDefinitions.projectId, projectId))
      .get(),
  );
  if (collection) {
    return yield* new ConflictError({
      message:
        "Deleting projects with collection records is not supported yet; no content was changed.",
    });
  }

  // Collect IDs needed for cascade deletion
  // Blocks on pages and in layouts both belong to the project.
  const blockRows = yield* Effect.promise(() =>
    ctx.db.select({ id: blocks.id }).from(blocks).where(eq(blocks.projectId, projectId)),
  );
  const blockIds = blockRows.map((r) => r.id);

  const repeatableItemRows = yield* Effect.promise(() =>
    ctx.db
      .select({ id: repeatableItems.id })
      .from(repeatableItems)
      .where(itemsInProject(projectId)),
  );
  const repeatableItemIds = repeatableItemRows.map((r) => r.id);

  const fileRows = yield* Effect.promise(() =>
    ctx.db
      .select({ id: files.id, blobId: files.blobId })
      .from(files)
      .where(eq(files.projectId, projectId)),
  );

  yield* Effect.promise(() =>
    ctx.db.delete(generatedValues).where(eq(generatedValues.projectId, projectId)),
  );

  // Delete in FK-safe order
  if (repeatableItemIds.length > 0) {
    yield* Effect.promise(() =>
      ctx.db.delete(repeatableItems).where(inArray(repeatableItems.id, repeatableItemIds)),
    );
  }
  yield* Effect.promise(() =>
    ctx.db.delete(sharedContents).where(eq(sharedContents.projectId, projectId)),
  );
  if (blockIds.length > 0) {
    yield* Effect.promise(() => ctx.db.delete(blocks).where(inArray(blocks.id, blockIds)));
  }
  yield* Effect.promise(() => ctx.db.delete(pages).where(eq(pages.projectId, projectId)));

  // Delete files from R2 and database
  if (fileRows.length > 0) {
    yield* Effect.promise(() =>
      Promise.all(
        fileRows.flatMap((f) => [
          ctx.env.FILES_BUCKET.delete(f.blobId),
          ctx.env.FILES_BUCKET.delete(optimizedVideoKey(f.blobId)),
        ]),
      ),
    );
    yield* Effect.promise(() => ctx.db.delete(files).where(eq(files.projectId, projectId)));
  }

  // Delete project favicon from R2 (no DB row to clean up — favicons are R2-only)
  yield* Effect.promise(() => ctx.env.FILES_BUCKET.delete(`favicons/${projectId}`));

  yield* Effect.promise(() => ctx.db.delete(layouts).where(eq(layouts.projectId, projectId)));
  yield* Effect.promise(() =>
    ctx.db.delete(blockDefinitions).where(eq(blockDefinitions.projectId, projectId)),
  );
  yield* Effect.promise(() =>
    ctx.db.delete(collectionDefinitions).where(eq(collectionDefinitions.projectId, projectId)),
  );
  yield* Effect.promise(() => ctx.db.delete(locales).where(eq(locales.projectId, projectId)));

  const result = yield* Effect.promise(() =>
    ctx.db.delete(projects).where(eq(projects.id, projectId)).returning().get(),
  );
  yield* record(ctx.db, { kind: "project", projectId });
  return result;
});

/**
 * Inserts content a sync seeds: on Live as released content, in a development draft as a draft
 * row (ADR 0006).
 */
const seed = Effect.fn("projects.seed")(function* <T extends overlay.ContentTable>(
  ctx: ServiceContext,
  target: WriteTarget,
  table: T,
  values: Omit<T["$inferInsert"], "id" | "draftId">,
) {
  // A fresh id, so the target can't already hold the entity.
  const inserted = yield* overlay.insert(ctx.db, target, table, values as never);
  return inserted! as T["$inferSelect"];
});

export const initializeProjectContent = Effect.fn("projects.initializeProjectContent")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof initializeProjectContentInput>,
) {
  const input = yield* decodeInput(initializeProjectContentInput, rawInput);
  // A release seeds Live; dev mode seeds the caller's development draft, as draft rows
  // (ADR 0006).
  const {
    project,
    scope: draft,
    writes,
  } = yield* assertSyncAccess(
    ctx.db,
    input.projectSlug,
    { user: ctx.user, draft: ctx.draft, deployToken: input.deployToken },
    { create: true },
  );

  // Skip when the target already reads pages (idempotent).
  const existingPage = yield* Effect.promise(() =>
    ctx.db
      .select()
      .from(pages)
      .where(and(eq(pages.projectId, project.id), visibleIn(pages, draft)))
      .limit(1)
      .get(),
  );
  if (existingPage) {
    return { created: false };
  }

  const now = Date.now();

  // Find the specified layout
  const layout = yield* Effect.promise(() =>
    ctx.db
      .select()
      .from(layouts)
      .where(
        and(
          eq(layouts.projectId, project.id),
          definitionsIn(layouts, draft),
          eq(layouts.layoutId, input.layoutId),
        ),
      )
      .get(),
  );
  if (!layout || layout.kind !== "curated") {
    return { created: false };
  }

  const definitions = yield* Effect.promise(() =>
    ctx.db
      .select()
      .from(blockDefinitions)
      .where(
        and(eq(blockDefinitions.projectId, project.id), definitionsIn(blockDefinitions, draft)),
      ),
  );
  const definitionsByType = new Map(
    definitions.map((definition) => [definition.blockId, definition]),
  );
  // Reject an invalid later block before creating the homepage or any earlier
  // block, and use the same normalized/defaulted values for persistence.
  const preparedBlocks = yield* Effect.forEach(input.blocks, (block) => {
    const definition = definitionsByType.get(block.type);
    return Effect.map(
      prepareBlockContent(
        block.content,
        block.settings,
        block.repeatableItems,
        definition?.contentSchema,
        definition?.settingsSchema,
      ),
      (prepared) => ({ ...block, ...prepared, repeatableItems: prepared.seeds }),
    );
  });

  for (const block of preparedBlocks) {
    const scope = { projectId: project.id, draft };
    const schema = definitionsByType.get(block.type)?.contentSchema;
    // Validation finds every record a reference names in scope; a required one must name one.
    yield* validateReferenceValues(ctx, scope, schema, block.bundle);
    const content = block.content as Record<string, unknown>;
    const empty = (field: Field) => pointersOf(field, content[field.name]).length === 0;
    if (fieldsOf(schema).some((f) => f.kind === "Reference" && f.required && empty(f))) {
      return yield* new InvalidInputError({
        message: "Bootstrap requires its required references to link existing records",
      });
    }
  }

  // Create homepage
  const homepage = yield* seed(ctx, writes, pages, {
    projectId: project.id,

    pathSegment: "",
    fullPath: "/",
    layoutId: layout.layoutId,
    nickname: "Home",
    contentUpdatedAt: now,
    createdAt: now,
    updatedAt: now,
  });

  // Create blocks on the homepage
  let prevPosition: string | null = null;
  let blockCount = 0;

  for (const blockDef of preparedBlocks) {
    const position = generateKeyBetween(prevPosition, null);
    prevPosition = position;

    const block = yield* seed(ctx, writes, blocks, {
      projectId: project.id,
      pageId: homepage.id,
      type: blockDef.type,
      content: blockDef.content,
      settings: blockDef.settings ?? null,
      position,
      createdAt: now,
      updatedAt: now,
    });

    const home = homeOf(draft, project.id);
    yield* requestGeneration(ctx.db, home, { entity: "block", row: block }, { immediately: true });

    const itemSeeds = blockDef.repeatableItems;
    if (itemSeeds && itemSeeds.length > 0) {
      const tempIdToRealId = new Map<string, string>();
      for (const itemSeed of itemSeeds) {
        const parentItemId = itemSeed.parentTempId
          ? (tempIdToRealId.get(itemSeed.parentTempId) ?? null)
          : null;
        const inserted = yield* seed(ctx, writes, repeatableItems, {
          blockId: block.id,
          parentItemId,
          fieldName: itemSeed.fieldName,
          content: itemSeed.content,
          settings: itemSeed.settings ?? null,
          position: itemSeed.position,
          createdAt: now,
          updatedAt: now,
        });
        tempIdToRealId.set(itemSeed.tempId, inserted.id);
        yield* requestGeneration(
          ctx.db,
          home,
          { entity: "repeatableItem", row: inserted },
          { immediately: true },
        );
      }
    }

    yield* adoptSharedContent(ctx, writes, block);
    blockCount++;
  }

  // The homepage's SEO waits for its blocks' edits, like after any edit (ADR 0012).
  yield* requestGeneration(ctx.db, homeOf(draft, project.id), { entity: "page", row: homepage });
  return { created: true, pageId: homepage.id, blockCount };
});
