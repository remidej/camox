import { projectIdSchema } from "@camox/api-contract/ids";
import {
  projectSlugSchema,
  RESERVED_PROJECT_SLUGS,
  socialProfileUrlSchema,
  UNAVAILABLE_SLUG_MESSAGES,
  type UnavailableSlugReason,
} from "@camox/api-contract/projects";
import { and, eq, inArray, type SQL } from "drizzle-orm";
import { Effect } from "effect";
import { generateKeyBetween } from "fractional-indexing";
import { z } from "zod";

import { assertOrgMembership, getAuthorizedProject, requireUser } from "../../authorization";
import type { SyncTarget } from "../../authorization";
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
import { type Field, fieldsOf, pointersOf } from "../_shared/fields";
import type { ServiceContext } from "../_shared/service-context";
import type { SyncedDefinitions } from "../block-definitions/service";
import { prepareBlockContent } from "../blocks/prepare-content";
import { planDeclaredPlacement } from "../blocks/shared-content";
import { validateReferenceValues } from "../collections/references";
import { accessTo } from "../drafts/access";
import * as overlay from "../drafts/overlay";
import { visibleIn } from "../drafts/overlay";
import { optimizedVideoKey } from "../files/video-optimization";
import type { GenerationRequest } from "../generated-values/generation";
import { homeOf } from "../generated-values/service";
import { repeatableItemSeedSchema } from "../layouts/service";
import { insertInitialLocale } from "../locales/service";
import { sendSetupFailureAlert } from "../project-creation/alert";
import { sendCleanupFailureAlert } from "../project-deletion/alert";
import { itemsInProject } from "../repeatable-items/roots";
import { analyticsColumns, analyticsOf, analyticsProvidersInput } from "./analytics";
import { publicProjectSummary } from "./public-summary";
import { namingProject, projectRefOf } from "./ref";

// --- Input Schemas ---
// Exported so adapters (oRPC, MCP, CLI) share the same canonical contract.
// Services .parse() them on entry — service is the trust boundary.

export const listProjectsInput = z.object({ organizationId: z.string() });
export const getFirstProjectInput = z.object({ organizationId: z.string() });
export const getProjectBySlugInput = z.object({ slug: z.string() });
/** A project by its Project ID, as a website's code and the CLI name it. */
export const getProjectByUuidInput = z.object({ projectUuid: projectIdSchema });
export const getProjectInput = z.object({ id: z.number() });
/** A project by its Project ID, as anyone may read what its website shows of it. */
export const getProjectSummaryInput = namingProject(z.object({}));
export const checkProjectSlugAvailabilityInput = z.object({ slug: z.string() });
export const createProjectInput = z.object({
  name: z.string(),
  slug: z.string(),
  organizationId: z.string(),
});
export const updateProjectInput = z.object({ id: z.number(), name: z.string() });
export const deleteProjectInput = z.object({ id: z.number() });
export const updateProjectAnalyticsInput = analyticsProvidersInput.extend({ id: z.number() });
/** The project's social profiles, in order, replacing the ones it had. */
export const updateProjectSocialProfilesInput = z.object({
  id: z.number(),
  socialProfiles: z.array(socialProfileUrlSchema).max(50),
});

/** The homepage content a Definition Set declares: its layout and initial blocks. */
export const homepageInput = z.object({
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

/** A project as its organization's members read it. */
function memberProjectView(result: {
  project: typeof projects.$inferSelect;
  organizationSlug: string | null;
}) {
  return {
    ...result.project,
    organizationSlug: result.organizationSlug,
    analytics: analyticsOf(result.project),
  };
}

/** The project `where` selects, as its organization's members read it, for the member `userId`. */
const memberProject = Effect.fn("projects.memberProject")(function* (
  ctx: ServiceContext,
  userId: string,
  where: SQL,
) {
  const result = yield* Effect.promise(() =>
    ctx.db
      .select({
        project: projects,
        organizationSlug: organizationTable.slug,
      })
      .from(projects)
      .innerJoin(organizationTable, eq(organizationTable.id, projects.organizationId))
      .where(where)
      .get(),
  );
  if (!result) return yield* new NotFoundError();
  yield* assertOrgMembership(ctx.db, userId, result.project.organizationId);
  return memberProjectView(result);
});

export const getProjectBySlug = Effect.fn("projects.getProjectBySlug")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof getProjectBySlugInput>,
) {
  const user = yield* requireUser(ctx);
  const { slug } = yield* decodeInput(getProjectBySlugInput, rawInput);
  return yield* memberProject(ctx, user.id, eq(projects.slug, slug));
});

/**
 * What a project's website shows of it, as page reads carry it, read alone: for the website's
 * routes that need the project without a page, such as its logo. Public, like Live.
 */
export const getProjectSummary = Effect.fn("projects.getProjectSummary")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof getProjectSummaryInput>,
) {
  const named = yield* decodeInput(getProjectSummaryInput, rawInput);
  const { project } = yield* accessTo(ctx, projectRefOf(named), "public");
  return publicProjectSummary(project);
}, Effect.scoped);

export const getProjectByUuid = Effect.fn("projects.getProjectByUuid")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof getProjectByUuidInput>,
) {
  const user = yield* requireUser(ctx);
  const { projectUuid } = yield* decodeInput(getProjectByUuidInput, rawInput);
  return yield* memberProject(ctx, user.id, eq(projects.uuid, projectUuid));
});

export const getProject = Effect.fn("projects.getProject")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof getProjectInput>,
) {
  const user = yield* requireUser(ctx);
  const { id } = yield* decodeInput(getProjectInput, rawInput);
  return yield* memberProject(ctx, user.id, eq(projects.id, id));
});

/** Why `slug` can't be given to a new project, or null when it can. */
const unavailableSlugReason = Effect.fn("projects.unavailableSlugReason")(function* (
  ctx: ServiceContext,
  slug: string,
) {
  if (!projectSlugSchema.safeParse(slug).success) return "invalid" as UnavailableSlugReason;
  if (RESERVED_PROJECT_SLUGS.has(slug)) return "reserved" as UnavailableSlugReason;
  const existing = yield* Effect.promise(() =>
    ctx.db.select({ id: projects.id }).from(projects).where(eq(projects.slug, slug)).get(),
  );
  return existing ? ("taken" as UnavailableSlugReason) : null;
});

export const checkProjectSlugAvailability = Effect.fn("projects.checkProjectSlugAvailability")(
  function* (ctx: ServiceContext, rawInput: z.input<typeof checkProjectSlugAvailabilityInput>) {
    yield* requireUser(ctx);
    const { slug } = yield* decodeInput(checkProjectSlugAvailabilityInput, rawInput);
    const reason = yield* unavailableSlugReason(ctx, slug);
    return reason ? { available: false, reason } : { available: true };
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

  const unavailable = yield* unavailableSlugReason(ctx, input.slug);
  if (unavailable === "taken") {
    return yield* new ConflictError({ message: UNAVAILABLE_SLUG_MESSAGES.taken });
  }
  if (unavailable) {
    return yield* new InvalidInputError({ message: UNAVAILABLE_SLUG_MESSAGES[unavailable] });
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
        status: "settingUp",
        setupStep: "copyTemplate",
        createdAt: now,
        updatedAt: now,
      })
      // Two requests for the same slug: the unique index lets one through.
      .onConflictDoNothing({ target: projects.slug })
      .returning()
      .get(),
  );
  if (!result) return yield* new ConflictError({ message: UNAVAILABLE_SLUG_MESSAGES.taken });

  yield* Effect.promise(() => insertInitialLocale(ctx.db, result.id, now));
  const started = yield* Effect.promise(() =>
    startSetup(ctx.env, result).then(
      () => true,
      (error: unknown) => {
        console.error("Setup not started", result.uuid, error);
        return false;
      },
    ),
  );
  if (started) return result;

  // The setup gave up before its Workflow could: it fails at its first step, as one would.
  const failed = yield* Effect.promise(() =>
    ctx.db
      .update(projects)
      .set({ status: "setupFailed", setupStep: "copyTemplate" })
      .where(eq(projects.id, result.id))
      .returning()
      .get(),
  );
  yield* Effect.promise(() =>
    sendSetupFailureAlert(ctx.env, {
      project: { projectId: result.uuid, name: result.name },
      failedStep: "copyTemplate",
      workflowInstanceId: null,
    }).catch((alertError: unknown) => console.error("Setup failure alert not sent", alertError)),
  );
  return failed ?? result;
});

/** Maps a new project's host to it, then starts its creation Workflow. */
async function startSetup(env: ServiceContext["env"], project: { slug: string; uuid: string }) {
  // `<slug>.camox.site` answers at once, with the setup page until the first release deploys.
  await env.PROJECT_SLUGS.put(project.slug, project.uuid);
  // Named after the Project ID, so the project's setup is one instance, and a repeated start fails.
  try {
    await env.PROJECT_CREATION_WORKFLOW.create({
      id: project.uuid,
      params: { projectId: project.uuid },
    });
  } catch (error) {
    // A start whose response was lost: the instance exists.
    await env.PROJECT_CREATION_WORKFLOW.get(project.uuid).catch(() => {
      throw error;
    });
  }
}

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

/** Sets the social profiles: a Project Setting, so Live and every draft change at once. */
export const updateProjectSocialProfiles = Effect.fn("projects.updateProjectSocialProfiles")(
  function* (ctx: ServiceContext, rawInput: z.input<typeof updateProjectSocialProfilesInput>) {
    const user = yield* requireUser(ctx);
    const { id, socialProfiles } = yield* decodeInput(updateProjectSocialProfilesInput, rawInput);
    yield* getAuthorizedProject(ctx.db, id, user.id);
    const result = yield* Effect.promise(() =>
      ctx.db
        .update(projects)
        .set({ socialProfiles, updatedAt: Date.now() })
        .where(eq(projects.id, id))
        .returning()
        .get(),
    );
    yield* record(ctx.db, { kind: "project", projectId: id });
    return { socialProfiles: result.socialProfiles, updatedAt: result.updatedAt };
  },
);

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
  // `<slug>.camox.site` answers with the not-found page at once.
  yield* Effect.promise(() => ctx.env.PROJECT_SLUGS.delete(project.slug));
  // Its Worker and repo are cleaned up in the background. Named after the Project ID, so a
  // project's cleanup is one instance. The project is gone either way: a cleanup that can't
  // start leaves them behind, for Rémi to delete.
  yield* Effect.promise(() =>
    ctx.env.PROJECT_DELETION_WORKFLOW.create({
      id: project.uuid,
      params: { projectId: project.uuid, name: project.name },
    }).then(
      () => undefined,
      async (error: unknown) => {
        console.error("Cleanup not started", project.uuid, error);
        await sendCleanupFailureAlert(ctx.env, {
          project: { projectId: project.uuid, name: project.name },
          failedSteps: ["Starting the cleanup"],
          leftBehind: [`Worker ${project.uuid}`, `repo ${project.uuid}`],
          workflowInstanceId: null,
        }).catch((alertError: unknown) =>
          console.error("Cleanup failure alert not sent", alertError),
        );
      },
    ),
  );
  return result;
});

/** What planning the homepage tells: whether it is created, and the values to generate after. */
type HomepagePlan = {
  homepage: { created: false } | { created: true; pageId: string; blockCount: number };
  generation: (GenerationRequest & { immediately: boolean })[];
};

/**
 * Plans the homepage a Definition Set declares, with its blocks, for a target that reads no page
 * yet: on Live as released content, in a development draft as draft rows (ADR 0006). Plans
 * nothing once the target reads pages, or when the layout isn't a curated one the target holds
 * once the sync ran (`layouts`). Block and collection definitions come from the sync
 * (`definitions`, `collections`); `definitions` learns the ones the homepage gives shared content.
 *
 * Also tells the generated values to request once the batch ran.
 */
export const planHomepage = Effect.fn("projects.planHomepage")(function* (
  ctx: ServiceContext,
  { project, scope: draft, writes }: SyncTarget,
  homepage: z.infer<typeof homepageInput>,
  {
    layouts: syncedLayouts,
    definitions,
    collections,
  }: {
    layouts: readonly { layoutId: string; kind: string }[];
    definitions: SyncedDefinitions;
    collections: ReadonlySet<string>;
  },
) {
  const nothing = overlay.nothingPlanned<HomepagePlan>({
    homepage: { created: false },
    generation: [],
  });
  // Skip when the target already reads pages (idempotent).
  const existingPage = yield* Effect.promise(() =>
    ctx.db
      .select()
      .from(pages)
      .where(and(eq(pages.projectId, project.id), visibleIn(pages, draft)))
      .limit(1)
      .get(),
  );
  if (existingPage) return nothing;

  const layout = syncedLayouts.find((candidate) => candidate.layoutId === homepage.layoutId);
  if (!layout || layout.kind !== "curated") return nothing;

  // Reject an invalid later block before planning the homepage or any earlier
  // block, and use the same normalized/defaulted values for persistence.
  const preparedBlocks = yield* Effect.forEach(homepage.blocks, (block) => {
    const definition = definitions.get(block.type);
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
    const scope = { projectId: project.id, draft, collections };
    const schema = definitions.get(block.type)?.contentSchema;
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

  const now = Date.now();
  const plan = overlay.planner();
  const home = homeOf(draft, project.id);
  const generation: HomepagePlan["generation"] = [];
  // A fresh id, so the target can't already hold the page.
  const page = plan.add(
    yield* overlay.planInsert(ctx.db, writes, pages, {
      projectId: project.id,
      pathSegment: "",
      fullPath: "/",
      layoutId: layout.layoutId,
      nickname: "Home",
      contentUpdatedAt: now,
      createdAt: now,
      updatedAt: now,
    }),
  )!;

  let prevPosition: string | null = null;
  for (const blockDef of preparedBlocks) {
    const position = generateKeyBetween(prevPosition, null);
    prevPosition = position;
    const definition = definitions.get(blockDef.type);
    const placed = plan.add(
      yield* planDeclaredPlacement(
        ctx.db,
        writes,
        {
          projectId: project.id,
          pageId: page.id,
          type: blockDef.type,
          content: blockDef.content,
          settings: blockDef.settings ?? null,
          position,
        },
        blockDef.repeatableItems,
        {
          synced: definition?.synced ?? false,
          hasSharedContent: definition?.hasSharedContent ?? false,
        },
      ),
    );
    if (definition && placed.adoption === "seeded") definition.hasSharedContent = true;
    const immediately = true;
    generation.push({ home, target: { entity: "block", row: placed.block }, immediately });
    for (const item of placed.items) {
      generation.push({ home, target: { entity: "repeatableItem", row: item }, immediately });
    }
  }

  // The homepage's SEO waits for its blocks' edits, like after any edit (ADR 0012).
  generation.push({ home, target: { entity: "page", row: page }, immediately: false });
  return plan.done<HomepagePlan>({
    homepage: { created: true, pageId: page.id, blockCount: preparedBlocks.length },
    generation,
  });
});
