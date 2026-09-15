import { ORPCError } from "@orpc/server";
import { and, eq, inArray, or } from "drizzle-orm";
import { generateKeyBetween } from "fractional-indexing";
import { z } from "zod";

import { assertOrgMembership, assertSyncAccess, getAuthorizedProject } from "../../authorization";
import { resolveEnvironment } from "../../lib/resolve-environment";
import { scheduleAiJob } from "../../lib/schedule-ai-job";
import {
  aiJobs,
  blockDefinitions,
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
import { syncBlockData } from "../blocks/synced";
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

function assertUser(ctx: ServiceContext) {
  if (!ctx.user) throw new ORPCError("UNAUTHORIZED");
  return ctx.user;
}

// --- Reads ---

export async function listProjects(
  ctx: ServiceContext,
  rawInput: z.input<typeof listProjectsInput>,
) {
  const user = assertUser(ctx);
  const { organizationId } = listProjectsInput.parse(rawInput);
  await assertOrgMembership(ctx.db, user.id, organizationId);
  return ctx.db.select().from(projects).where(eq(projects.organizationId, organizationId));
}

export async function getFirstProject(
  ctx: ServiceContext,
  rawInput: z.input<typeof getFirstProjectInput>,
) {
  const user = assertUser(ctx);
  const { organizationId } = getFirstProjectInput.parse(rawInput);
  await assertOrgMembership(ctx.db, user.id, organizationId);
  const result = await ctx.db
    .select()
    .from(projects)
    .where(eq(projects.organizationId, organizationId))
    .limit(1)
    .get();
  if (!result) throw new ORPCError("NOT_FOUND");
  return result;
}

export async function getProjectBySlug(
  ctx: ServiceContext,
  rawInput: z.input<typeof getProjectBySlugInput>,
) {
  const user = assertUser(ctx);
  const { slug } = getProjectBySlugInput.parse(rawInput);
  const result = await ctx.db
    .select({
      project: projects,
      organizationSlug: organizationTable.slug,
    })
    .from(projects)
    .innerJoin(organizationTable, eq(organizationTable.id, projects.organizationId))
    .where(eq(projects.slug, slug))
    .get();
  if (!result) throw new ORPCError("NOT_FOUND");
  await assertOrgMembership(ctx.db, user.id, result.project.organizationId);
  return { ...result.project, organizationSlug: result.organizationSlug };
}

export async function getProject(ctx: ServiceContext, rawInput: z.input<typeof getProjectInput>) {
  const user = assertUser(ctx);
  const { id } = getProjectInput.parse(rawInput);
  const result = await ctx.db
    .select({
      project: projects,
      organizationSlug: organizationTable.slug,
    })
    .from(projects)
    .innerJoin(organizationTable, eq(organizationTable.id, projects.organizationId))
    .where(eq(projects.id, id))
    .get();
  if (!result) throw new ORPCError("NOT_FOUND");
  await assertOrgMembership(ctx.db, user.id, result.project.organizationId);
  return { ...result.project, organizationSlug: result.organizationSlug };
}

export async function checkProjectSlugAvailability(
  ctx: ServiceContext,
  rawInput: z.input<typeof checkProjectSlugAvailabilityInput>,
) {
  assertUser(ctx);
  const { slug } = checkProjectSlugAvailabilityInput.parse(rawInput);
  const existing = await ctx.db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.slug, slug))
    .get();
  return { available: !existing };
}

// --- Writes ---

export async function createProject(
  ctx: ServiceContext,
  rawInput: z.input<typeof createProjectInput>,
) {
  const user = assertUser(ctx);
  const input = createProjectInput.parse(rawInput);
  await assertOrgMembership(ctx.db, user.id, input.organizationId);

  // Race condition guard: check slug uniqueness at insert time
  const existing = await ctx.db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.slug, input.slug))
    .get();
  if (existing) {
    throw new ORPCError("CONFLICT", { message: "Slug is already taken" });
  }

  const deployToken = crypto.randomUUID();
  const now = Date.now();

  const result = await ctx.db
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
    .get();

  await ctx.db.insert(environments).values({
    projectId: result.id,
    name: "production",
    type: "production",
    createdAt: now,
    updatedAt: now,
  });

  return result;
}

export async function updateProject(
  ctx: ServiceContext,
  rawInput: z.input<typeof updateProjectInput>,
) {
  const user = assertUser(ctx);
  const { id, ...body } = updateProjectInput.parse(rawInput);
  const project = await getAuthorizedProject(ctx.db, id, user.id);
  if (!project) throw new ORPCError("NOT_FOUND");
  const result = await ctx.db
    .update(projects)
    .set({ ...body, updatedAt: Date.now() })
    .where(eq(projects.id, id))
    .returning()
    .get();
  return result;
}

export async function deleteProject(
  ctx: ServiceContext,
  rawInput: z.input<typeof deleteProjectInput>,
) {
  const user = assertUser(ctx);
  const { id } = deleteProjectInput.parse(rawInput);
  const project = await getAuthorizedProject(ctx.db, id, user.id);
  if (!project) throw new ORPCError("NOT_FOUND");

  const projectId = project.id;

  // Collect IDs needed for cascade deletion
  const pageRows = await ctx.db
    .select({ id: pages.id })
    .from(pages)
    .where(eq(pages.projectId, projectId));
  const pageIds = pageRows.map((r) => r.id);

  const layoutRows = await ctx.db
    .select({ id: layouts.id })
    .from(layouts)
    .where(eq(layouts.projectId, projectId));
  const layoutIds = layoutRows.map((r) => r.id);

  const blockConditions = [
    ...(pageIds.length > 0 ? [inArray(blocks.pageId, pageIds)] : []),
    ...(layoutIds.length > 0 ? [inArray(blocks.layoutId, layoutIds)] : []),
  ];
  const blockRows =
    blockConditions.length > 0
      ? await ctx.db
          .select({ id: blocks.id })
          .from(blocks)
          .where(or(...blockConditions))
      : [];
  const blockIds = blockRows.map((r) => r.id);

  const repeatableItemRows =
    blockIds.length > 0
      ? await ctx.db
          .select({ id: repeatableItems.id })
          .from(repeatableItems)
          .where(inArray(repeatableItems.blockId, blockIds))
      : [];
  const repeatableItemIds = repeatableItemRows.map((r) => r.id);

  const fileRows = await ctx.db
    .select({ id: files.id, blobId: files.blobId })
    .from(files)
    .where(eq(files.projectId, projectId));
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
    await ctx.db.delete(aiJobs).where(or(...aiJobConditions));
  }

  // Delete in FK-safe order
  if (repeatableItemIds.length > 0) {
    await ctx.db.delete(repeatableItems).where(inArray(repeatableItems.id, repeatableItemIds));
  }
  if (blockIds.length > 0) {
    await ctx.db.delete(blocks).where(inArray(blocks.id, blockIds));
  }
  await ctx.db.delete(pages).where(eq(pages.projectId, projectId));

  // Delete files from R2 and database
  if (fileRows.length > 0) {
    await Promise.all(fileRows.map((f) => ctx.env.FILES_BUCKET.delete(f.blobId)));
    await ctx.db.delete(files).where(eq(files.projectId, projectId));
  }

  // Delete project favicon from R2 (no DB row to clean up — favicons are R2-only)
  await ctx.env.FILES_BUCKET.delete(`favicons/${projectId}`);

  await ctx.db.delete(layouts).where(eq(layouts.projectId, projectId));
  await ctx.db.delete(blockDefinitions).where(eq(blockDefinitions.projectId, projectId));
  await ctx.db.delete(environments).where(eq(environments.projectId, projectId));

  const result = await ctx.db.delete(projects).where(eq(projects.id, projectId)).returning().get();
  return result;
}

export async function initializeProjectContent(
  ctx: ServiceContext,
  rawInput: z.input<typeof initializeProjectContentInput>,
) {
  const input = initializeProjectContentInput.parse(rawInput);
  const project = await assertSyncAccess(ctx.db, input.projectSlug, {
    user: ctx.user,
    environmentName: ctx.environmentName,
    deployToken: input.deployToken,
  });

  const environment = await resolveEnvironment(ctx.db, project.id, ctx.environmentName);

  // Check if environment already has pages — if so, skip (idempotent)
  const existingPage = await ctx.db
    .select()
    .from(pages)
    .where(eq(pages.environmentId, environment.id))
    .limit(1)
    .get();
  if (existingPage) {
    return { created: false };
  }

  const now = Date.now();

  // Find the specified layout
  const layout = await ctx.db
    .select()
    .from(layouts)
    .where(
      and(
        eq(layouts.projectId, project.id),
        eq(layouts.environmentId, environment.id),
        eq(layouts.layoutId, input.layoutId),
      ),
    )
    .get();
  if (!layout) {
    return { created: false };
  }

  // Create homepage
  const homepage = await ctx.db
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
    .get();

  // Create blocks on the homepage
  let prevPosition: string | null = null;
  let blockCount = 0;

  for (const blockDef of input.blocks) {
    const position = generateKeyBetween(prevPosition, null);
    prevPosition = position;

    const block = await ctx.db
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
      .get();

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
        const inserted = await ctx.db
          .insert(repeatableItems)
          .values({
            blockId: block.id,
            parentItemId,
            fieldName: seed.fieldName,
            content: seed.content,
            summary: "",
            position: seed.position,
            createdAt: now,
            updatedAt: now,
          })
          .returning()
          .get();
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

    await syncBlockData(ctx, block.id, true);
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
    await writeLayoutCheckpointAndPoint(ctx, { layout, userId: syncUserId });
  }
  await writePageCheckpointAndPoint(ctx, { page: homepage, userId: syncUserId });

  return { created: true, pageId: homepage.id, blockCount };
}
