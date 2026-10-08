import { and, eq, inArray, or } from "drizzle-orm";
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
import { resolveEnvironment } from "../../lib/resolve-environment";
import { scheduleAiJob } from "../../lib/schedule-ai-job";
import {
  aiJobs,
  blockDefinitions,
  collectionDefinitions,
  collectionRecords,
  blocks,
  environments,
  files,
  layouts,
  organizationTable,
  pages,
  projects,
  repeatableItems,
} from "../../schema";
import type { ServiceContext } from "../_shared/service-context";
import { prepareBlockContent } from "../blocks/prepare-content";
import { syncBlockData } from "../blocks/synced";
import {
  referenceFields,
  resolveReferences,
  validateReferenceValues,
} from "../collections/references";
import { optimizedVideoKey } from "../files/video-optimization";
import { writeLayoutCheckpointAndPoint } from "../layouts/service";
import { writePageCheckpointAndPoint } from "../pages/service";

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
  return { ...result.project, organizationSlug: result.organizationSlug };
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
  return { ...result.project, organizationSlug: result.organizationSlug };
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

  yield* Effect.promise(() =>
    ctx.db.insert(environments).values({
      projectId: result.id,
      name: "production",
      type: "production",
      createdAt: now,
      updatedAt: now,
    }),
  );

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
  return result;
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
        eq(collectionRecords.definitionId, collectionDefinitions.id),
      )
      .where(eq(collectionDefinitions.projectId, projectId))
      .get(),
  );
  if (collection) {
    return yield* new ConflictError({
      message:
        "Deleting projects with collection history is not supported yet; no content was changed.",
    });
  }

  // Collect IDs needed for cascade deletion
  const pageRows = yield* Effect.promise(() =>
    ctx.db.select({ id: pages.id }).from(pages).where(eq(pages.projectId, projectId)),
  );
  const pageIds = pageRows.map((r) => r.id);

  const layoutRows = yield* Effect.promise(() =>
    ctx.db.select({ id: layouts.id }).from(layouts).where(eq(layouts.projectId, projectId)),
  );
  const layoutIds = layoutRows.map((r) => r.id);

  const blockConditions = [
    ...(pageIds.length > 0 ? [inArray(blocks.pageId, pageIds)] : []),
    ...(layoutIds.length > 0 ? [inArray(blocks.layoutId, layoutIds)] : []),
  ];
  const blockRows =
    blockConditions.length > 0
      ? yield* Effect.promise(() =>
          ctx.db
            .select({ id: blocks.id })
            .from(blocks)
            .where(or(...blockConditions)),
        )
      : [];
  const blockIds = blockRows.map((r) => r.id);

  const repeatableItemRows =
    blockIds.length > 0
      ? yield* Effect.promise(() =>
          ctx.db
            .select({ id: repeatableItems.id })
            .from(repeatableItems)
            .where(inArray(repeatableItems.blockId, blockIds)),
        )
      : [];
  const repeatableItemIds = repeatableItemRows.map((r) => r.id);

  const fileRows = yield* Effect.promise(() =>
    ctx.db
      .select({ id: files.id, blobId: files.blobId })
      .from(files)
      .where(eq(files.projectId, projectId)),
  );
  const fileIds = fileRows.map((r) => r.id);

  // Delete AI jobs for all collected entities
  const aiJobConditions = [
    ...(pageIds.length > 0
      ? [
          and(
            eq(aiJobs.entityTable, "pages"),
            inArray(
              aiJobs.entityId,
              pageIds.map((id) => String(id)),
            ),
          ),
        ]
      : []),
    ...(blockIds.length > 0
      ? [
          and(
            eq(aiJobs.entityTable, "blocks"),
            inArray(
              aiJobs.entityId,
              blockIds.map((id) => String(id)),
            ),
          ),
        ]
      : []),
    ...(repeatableItemIds.length > 0
      ? [
          and(
            eq(aiJobs.entityTable, "repeatableItems"),
            inArray(
              aiJobs.entityId,
              repeatableItemIds.map((id) => String(id)),
            ),
          ),
        ]
      : []),
    ...(fileIds.length > 0
      ? [
          and(
            eq(aiJobs.entityTable, "files"),
            inArray(
              aiJobs.entityId,
              fileIds.map((id) => String(id)),
            ),
          ),
        ]
      : []),
  ];
  if (aiJobConditions.length > 0) {
    yield* Effect.promise(() => ctx.db.delete(aiJobs).where(or(...aiJobConditions)));
  }

  // Delete in FK-safe order
  if (repeatableItemIds.length > 0) {
    yield* Effect.promise(() =>
      ctx.db.delete(repeatableItems).where(inArray(repeatableItems.id, repeatableItemIds)),
    );
  }
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
  yield* Effect.promise(() =>
    ctx.db.delete(environments).where(eq(environments.projectId, projectId)),
  );

  const result = yield* Effect.promise(() =>
    ctx.db.delete(projects).where(eq(projects.id, projectId)).returning().get(),
  );
  return result;
});

export const initializeProjectContent = Effect.fn("projects.initializeProjectContent")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof initializeProjectContentInput>,
) {
  const input = yield* decodeInput(initializeProjectContentInput, rawInput);
  const project = yield* assertSyncAccess(ctx.db, input.projectSlug, {
    user: ctx.user,
    environmentName: ctx.environmentName,
    deployToken: input.deployToken,
  });

  const environment = yield* resolveEnvironment(ctx.db, project.id, ctx.environmentName);

  // Check if environment already has pages — if so, skip (idempotent)
  const existingPage = yield* Effect.promise(() =>
    ctx.db.select().from(pages).where(eq(pages.environmentId, environment.id)).limit(1).get(),
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
          eq(layouts.environmentId, environment.id),
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
        and(
          eq(blockDefinitions.projectId, project.id),
          eq(blockDefinitions.environmentId, environment.id),
        ),
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
    const scope = { projectId: project.id, environmentId: environment.id };
    const schema = definitionsByType.get(block.type)?.contentSchema;
    yield* validateReferenceValues(ctx, scope, schema, block.bundle);
    const live = yield* resolveReferences(ctx, scope, schema, block.content, "live");
    if (referenceFields(schema).some(([name, field]) => field.required === true && !live[name])) {
      return yield* new InvalidInputError({
        message: "Bootstrap requires published required references",
      });
    }
  }

  // Create homepage
  const homepage = yield* Effect.promise(() =>
    ctx.db
      .insert(pages)
      .values({
        projectId: project.id,
        environmentId: environment.id,
        pathSegment: "",
        fullPath: "/",
        layoutId: layout.id,
        nickname: "Home",
        metaTitle: "Untitled page",
        metaDescription:
          "Title and description will be generated by AI as you edit the page's content.",
        contentUpdatedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get(),
  );

  // Create blocks on the homepage
  let prevPosition: string | null = null;
  let blockCount = 0;

  for (const blockDef of preparedBlocks) {
    const position = generateKeyBetween(prevPosition, null);
    prevPosition = position;

    const block = yield* Effect.promise(() =>
      ctx.db
        .insert(blocks)
        .values({
          pageId: homepage.id,
          type: blockDef.type,
          content: blockDef.content,
          settings: blockDef.settings ?? null,
          position,
          summary: "",
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get(),
    );

    ctx.waitUntil(
      scheduleAiJob(ctx.env.AI_JOB_SCHEDULER, {
        entityTable: "blocks",
        entityId: block.id,
        type: "summary",
        delayMs: 0,
      }),
    );

    const itemSeeds = blockDef.repeatableItems;
    if (itemSeeds && itemSeeds.length > 0) {
      const tempIdToRealId = new Map<string, number>();
      for (const seed of itemSeeds) {
        const parentItemId = seed.parentTempId
          ? (tempIdToRealId.get(seed.parentTempId) ?? null)
          : null;
        const inserted = yield* Effect.promise(() =>
          ctx.db
            .insert(repeatableItems)
            .values({
              blockId: block.id,
              parentItemId,
              fieldName: seed.fieldName,
              content: seed.content,
              settings: seed.settings ?? null,
              summary: "",
              position: seed.position,
              createdAt: now,
              updatedAt: now,
            })
            .returning()
            .get(),
        );
        tempIdToRealId.set(seed.tempId, inserted.id);
        ctx.waitUntil(
          scheduleAiJob(ctx.env.AI_JOB_SCHEDULER, {
            entityTable: "repeatableItems",
            entityId: inserted.id,
            type: "summary",
            delayMs: 0,
          }),
        );
      }
    }

    yield* syncBlockData(ctx, block.id, true);
    blockCount++;
  }

  // Auto-publish the homepage (and its layout, if it hasn't been published
  // yet) so the public site is immediately live after `camox init`. Without
  // this, the SDK page route 404s on every path until the user manually hits
  // publish in the studio. We only do it here — once the project exists, the
  // regular draft → publish UX takes over for new pages.
  //
  const syncUserId = ctx.user?.id ?? null;
  if (layout.livePublishedCheckpointId == null) {
    yield* writeLayoutCheckpointAndPoint(ctx, { layout, userId: syncUserId });
  }
  yield* writePageCheckpointAndPoint(ctx, { page: homepage, userId: syncUserId });

  return { created: true, pageId: homepage.id, blockCount };
});
