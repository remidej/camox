import { queryKeys } from "@camox/api-contract/query-keys";
import { and, eq, sql } from "drizzle-orm";
import { Effect } from "effect";
import { z } from "zod";

import { assertPageAccess, getAuthorizedProject, requireUser } from "../../authorization";
import { broadcastInvalidation } from "../../lib/broadcast-invalidation";
import { decodeInput, InvalidInputError, NotFoundError } from "../../lib/errors";
import { resolveEnvironment } from "../../lib/resolve-environment";
import { scheduleAiJob } from "../../lib/schedule-ai-job";
import { blocks, files, layouts, pages, projects, repeatableItems, user } from "../../schema";
import { injectRepeatableItemMarkers } from "../_shared/block-markers";
import { readOwnerBlocks } from "../_shared/owner-blocks";
import type { ServiceContext } from "../_shared/service-context";
import {
  hydrateItemReferences,
  hydrateReferences,
  type ResolvedReferences,
} from "../collections/references";
import { blocksOfLayout, layoutNamed } from "../layouts/identity";
import { assertCuratedLayout, assertUnreservedPagePaths } from "../layouts/route-ownership";
import { buildFileMap, collectFileIds, executePageSeo, sortByPosition } from "./ai";

const PAGE_NICKNAME_MAX_LENGTH = 80;
const pageNicknameSchema = z.string().trim().min(1).max(PAGE_NICKNAME_MAX_LENGTH);

function formatPathSegmentLabel(segment: string) {
  return segment.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function deriveDefaultPageNickname(pathSegment: string) {
  if (!pathSegment) return "Home";
  const label = formatPathSegmentLabel(pathSegment).trim();
  return (label || "Untitled page").slice(0, PAGE_NICKNAME_MAX_LENGTH);
}

// --- Input Schemas ---
// Exported so adapters (oRPC, MCP, CLI) share the same canonical contract.
// Services .parse() them on entry — service is the trust boundary.

export const getPageByPathInput = z.object({ projectSlug: z.string(), path: z.string() });
export const getPageStructureInput = z.object({ projectSlug: z.string(), path: z.string() });
export const listPagesInput = z.object({ projectId: z.number() });
export const listPagesBySlugInput = z.object({ projectSlug: z.string() });
export const getPageInput = z.union([
  z.object({ id: z.number() }),
  z.object({ projectId: z.number(), path: z.string() }),
]);

export const createPageInput = z.object({
  projectId: z.number(),
  nickname: pageNicknameSchema.optional(),
  pathSegment: z.string(),
  parentPageId: z.number().optional(),
  /** The name of the page's layout. */
  layoutId: z.string(),
});
export const updatePageInput = z
  .object({
    id: z.number(),
    nickname: pageNicknameSchema.optional(),
    pathSegment: z.string().optional(),
    parentPageId: z.number().nullable().optional(),
    metaTitle: z.string().optional(),
    metaDescription: z.string().optional(),
    aiSeoEnabled: z.boolean().optional(),
  })
  .refine(({ id: _id, ...fields }) => Object.values(fields).some((value) => value !== undefined), {
    message: "Pass at least one field to update.",
  })
  .refine(
    (input) =>
      input.aiSeoEnabled !== true ||
      (input.metaTitle === undefined && input.metaDescription === undefined),
    { message: "Cannot enable automatic SEO alongside manual metadata." },
  );
export const deletePageInput = z.object({ id: z.number() });
export const setPageAiSeoInput = z.object({ id: z.number(), enabled: z.boolean() });
export const setPageMetaTitleInput = z.object({ id: z.number(), metaTitle: z.string() });
export const setPageMetaDescriptionInput = z.object({
  id: z.number(),
  metaDescription: z.string(),
});
/** `layoutId` names the page's new layout. */
export const setPageLayoutInput = z.object({ id: z.number(), layoutId: z.string() });
export const generatePageSeoInput = z.object({ id: z.number() });
function invalidatePage(ctx: ServiceContext, projectId: number, pageId: number) {
  broadcastInvalidation({
    waitUntil: ctx.waitUntil,
    projectRoomNamespace: ctx.env.ProjectRoom,
    projectId,
    // Pages using a block change with page creation, renames and deletion.
    targets: [
      queryKeys.pages.list,
      queryKeys.pages.getById(pageId),
      queryKeys.blocks.getUsageCounts,
    ],
  });
}

// --- Reads ---
//
// A page reads its current rows, whoever asks: an edit is visible right away.

type BlockRow = typeof blocks.$inferSelect;
type ItemRow = typeof repeatableItems.$inferSelect;
/** An item as the page view serves it, with its resolved references. */
type ViewItem = ItemRow & { references: ResolvedReferences };
type FileRow = typeof files.$inferSelect;

/** The page at a path in the project's environment, with its project and layout. */
const findPageByPath = Effect.fn("pages.findPageByPath")(function* (
  ctx: ServiceContext,
  projectSlug: string,
  fullPath: string,
) {
  const project = yield* Effect.promise(() =>
    ctx.db.select().from(projects).where(eq(projects.slug, projectSlug)).get(),
  );
  if (!project) return yield* new NotFoundError();
  const environment = yield* resolveEnvironment(ctx.db, project.id, ctx.environmentName);
  const page = yield* Effect.promise(() =>
    ctx.db
      .select()
      .from(pages)
      .where(and(eq(pages.fullPath, fullPath), eq(pages.environmentId, environment.id)))
      .get(),
  );
  if (!page) return yield* new NotFoundError();
  const layout =
    (yield* Effect.promise(() =>
      ctx.db.select().from(layouts).where(layoutNamed(page.environmentId, page.layoutId)).get(),
    )) ?? null;
  return { project, page, layout };
});

function layoutView(
  layout: typeof layouts.$inferSelect | null,
  layoutBlocks: { id: number; slot: "before" | "after" | null }[],
) {
  if (!layout) return null;
  return {
    layoutId: layout.layoutId,
    contentUpdatedAt: layout.contentUpdatedAt,
    updatedAt: layout.updatedAt,
    beforeBlockIds: layoutBlocks.filter((b) => b.slot === "before").map((b) => b.id),
    afterBlockIds: layoutBlocks.filter((b) => b.slot === "after").map((b) => b.id),
  };
}

function composePageView(args: {
  page: typeof pages.$inferSelect;
  project: typeof projects.$inferSelect;
  layout: typeof layouts.$inferSelect | null;
  pageBlocks: BlockRow[];
  layoutBlocks: BlockRow[];
  allItems: ViewItem[];
  fileRows: Map<string, FileRow>;
}) {
  const { page, project, layout, pageBlocks, layoutBlocks, allItems, fileRows } = args;

  const itemsByBlock = new Map<number, ViewItem[]>();
  for (const item of allItems) {
    const list = itemsByBlock.get(item.blockId) ?? [];
    list.push(item);
    itemsByBlock.set(item.blockId, list);
  }

  const normalizedBlocks = [...pageBlocks, ...layoutBlocks].map((block) =>
    injectRepeatableItemMarkers(block, itemsByBlock.get(block.id) ?? []),
  );

  return {
    page: { ...page, blockIds: pageBlocks.map((b) => b.id) },
    projectName: project.name,
    // `id` + `updatedAt` are enough for the SDK to build a cache-busted
    // favicon URL (`/favicons/${id}?v=${updatedAt}`) in the page <head>.
    project: { id: project.id, updatedAt: project.updatedAt },
    layout: layoutView(layout, layoutBlocks),
    blocks: normalizedBlocks.map(({ block }) => block),
    repeatableItems: normalizedBlocks.flatMap(({ items }) => items),
    files: [...fileRows.values()],
  };
}

export const getPageByPath = Effect.fn("pages.getPageByPath")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof getPageByPathInput>,
) {
  const { path, projectSlug } = yield* decodeInput(getPageByPathInput, rawInput);
  const { project, page, layout } = yield* findPageByPath(ctx, projectSlug, path);

  const pageContent = yield* readOwnerBlocks(ctx, { pageId: page.id });
  const layoutContent = layout ? yield* readOwnerBlocks(ctx, layout) : { blocks: [], items: [] };
  const allBlocks = [...pageContent.blocks, ...layoutContent.blocks];

  const hydrated = yield* hydrateReferences(ctx, page, allBlocks);
  const hydratedItems = yield* hydrateItemReferences(ctx, page, allBlocks, [
    ...pageContent.items,
    ...layoutContent.items,
  ]);
  const referencesByBlock = new Map(hydrated.map((block) => [block.id, block.references]));
  const fileIds = new Set<string>();
  for (const value of [...hydrated, ...hydratedItems]) {
    collectFileIds(value.content as Record<string, unknown>, fileIds);
    collectFileIds(value.references, fileIds);
  }
  const fileRows = yield* buildFileMap(ctx.db, fileIds);

  const view = composePageView({
    page,
    project,
    layout,
    pageBlocks: pageContent.blocks,
    layoutBlocks: layoutContent.blocks,
    allItems: hydratedItems,
    fileRows,
  });
  return {
    ...view,
    blocks: view.blocks.map((block) => ({
      ...block,
      references: referencesByBlock.get(block.id) ?? {},
    })),
  };
});

export const getPageStructure = Effect.fn("pages.getPageStructure")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof getPageStructureInput>,
) {
  const { path, projectSlug } = yield* decodeInput(getPageStructureInput, rawInput);
  const { project, page, layout } = yield* findPageByPath(ctx, projectSlug, path);

  const pageBlockOrder = sortByPosition(
    yield* Effect.promise(() =>
      ctx.db
        .select({ id: blocks.id, position: blocks.position })
        .from(blocks)
        .where(eq(blocks.pageId, page.id)),
    ),
  );
  const layoutBlockOrder = layout
    ? sortByPosition(
        yield* Effect.promise(() =>
          ctx.db
            .select({ id: blocks.id, position: blocks.position, slot: blocks.slot })
            .from(blocks)
            .where(blocksOfLayout(layout)),
        ),
      )
    : [];

  return {
    page: { ...page, blockIds: pageBlockOrder.map((b) => b.id) },
    projectName: project.name,
    project: { id: project.id, updatedAt: project.updatedAt },
    layout: layoutView(layout, layoutBlockOrder),
  };
});

export const listPages = Effect.fn("pages.listPages")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof listPagesInput>,
) {
  const { projectId } = yield* decodeInput(listPagesInput, rawInput);
  const environment = yield* resolveEnvironment(ctx.db, projectId, ctx.environmentName);
  return yield* Effect.promise(() =>
    ctx.db
      .select()
      .from(pages)
      .where(and(eq(pages.projectId, projectId), eq(pages.environmentId, environment.id))),
  );
});

export const listPagesBySlug = Effect.fn("pages.listPagesBySlug")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof listPagesBySlugInput>,
) {
  const { projectSlug } = yield* decodeInput(listPagesBySlugInput, rawInput);
  const project = yield* Effect.promise(() =>
    ctx.db.select().from(projects).where(eq(projects.slug, projectSlug)).get(),
  );
  if (!project) return yield* new NotFoundError();

  const environment = yield* resolveEnvironment(ctx.db, project.id, ctx.environmentName);
  return yield* Effect.promise(() =>
    ctx.db
      .select()
      .from(pages)
      .where(and(eq(pages.projectId, project.id), eq(pages.environmentId, environment.id))),
  );
});

export const getPage = Effect.fn("pages.getPage")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof getPageInput>,
) {
  const parsed = yield* decodeInput(getPageInput, rawInput);
  yield* requireUser(ctx);
  let row: typeof pages.$inferSelect | undefined;
  if ("id" in parsed) {
    row = yield* Effect.promise(() =>
      ctx.db.select().from(pages).where(eq(pages.id, parsed.id)).get(),
    );
  } else {
    const environment = yield* resolveEnvironment(ctx.db, parsed.projectId, ctx.environmentName);
    row = yield* Effect.promise(() =>
      ctx.db
        .select()
        .from(pages)
        .where(
          and(
            eq(pages.projectId, parsed.projectId),
            eq(pages.environmentId, environment.id),
            eq(pages.fullPath, parsed.path),
          ),
        )
        .get(),
    );
  }
  if (!row) return yield* new NotFoundError();
  const createdById = row.createdById;
  const creator = createdById
    ? yield* Effect.promise(() =>
        ctx.db.select({ name: user.name }).from(user).where(eq(user.id, createdById)).get(),
      )
    : undefined;
  return { ...row, createdBy: creator?.name ?? null };
});

// --- Writes ---

export const createPage = Effect.fn("pages.createPage")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof createPageInput>,
) {
  const user = yield* requireUser(ctx);
  const { projectId, nickname, pathSegment, parentPageId, layoutId } = yield* decodeInput(
    createPageInput,
    rawInput,
  );
  yield* getAuthorizedProject(ctx.db, projectId, user.id);
  const environment = yield* resolveEnvironment(ctx.db, projectId, ctx.environmentName);

  yield* assertCuratedLayout(ctx, environment.id, layoutId);
  let fullPath = `/${pathSegment}`;
  if (parentPageId) {
    const parent = yield* Effect.promise(() =>
      ctx.db
        .select()
        .from(pages)
        .where(and(eq(pages.id, parentPageId), eq(pages.environmentId, environment.id)))
        .get(),
    );
    if (!parent) return yield* new NotFoundError();
    fullPath = `${parent.fullPath.replace(/\/$/, "")}/${pathSegment}`;
  }
  yield* assertUnreservedPagePaths(ctx, environment.id, [fullPath]);

  const now = Date.now();
  const page = yield* Effect.promise(() =>
    ctx.db
      .insert(pages)
      .values({
        projectId,
        environmentId: environment.id,
        pathSegment,
        fullPath,
        parentPageId: parentPageId ?? null,
        layoutId,
        nickname: nickname ?? deriveDefaultPageNickname(pathSegment),
        contentUpdatedAt: now,
        createdById: user.id,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get(),
  );

  invalidatePage(ctx, projectId, page.id);

  return { page, fullPath: page.fullPath };
});

export const updatePage = Effect.fn("pages.updatePage")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof updatePageInput>,
) {
  const user = yield* requireUser(ctx);
  const { id, ...body } = yield* decodeInput(updatePageInput, rawInput);
  if (body.metaTitle !== undefined || body.metaDescription !== undefined) {
    body.aiSeoEnabled = false;
  }
  const access = yield* assertPageAccess(ctx.db, id, user.id);

  const pathChanges = new Map<number, string>();
  if (body.pathSegment !== undefined || body.parentPageId !== undefined) {
    const environmentPages = yield* Effect.promise(() =>
      ctx.db.select().from(pages).where(eq(pages.environmentId, access.page.environmentId)),
    );
    const parentId = body.parentPageId === undefined ? access.page.parentPageId : body.parentPageId;
    const parent = environmentPages.find((page) => page.id === parentId);
    if (parentId != null && !parent) return yield* new NotFoundError();
    // Reject cycles before calculating paths for this page and its descendants.
    let ancestor = parent;
    while (ancestor) {
      if (ancestor.id === id)
        return yield* new InvalidInputError({ message: "A page cannot be its own ancestor" });
      ancestor = environmentPages.find((page) => page.id === ancestor!.parentPageId);
    }
    const fullPath = `${parent?.fullPath.replace(/\/$/, "") ?? ""}/${body.pathSegment ?? access.page.pathSegment}`;
    const visit = (pageId: number, path: string) => {
      pathChanges.set(pageId, path);
      for (const child of environmentPages.filter((page) => page.parentPageId === pageId))
        visit(child.id, `${path.replace(/\/$/, "")}/${child.pathSegment}`);
    };
    visit(id, fullPath);
    yield* assertUnreservedPagePaths(ctx, access.page.environmentId, [...pathChanges.values()]);
  }

  const now = Math.max(Date.now(), access.page.updatedAt + 1);
  const [result] = yield* Effect.promise(() =>
    ctx.db.batch([
      ctx.db
        .update(pages)
        .set({ ...body, fullPath: pathChanges.get(id) ?? access.page.fullPath, updatedAt: now })
        .where(eq(pages.id, id))
        .returning(),
      ...[...pathChanges]
        .filter(([pageId]) => pageId !== id)
        .map(([pageId, fullPath]) =>
          ctx.db.update(pages).set({ fullPath, updatedAt: now }).where(eq(pages.id, pageId)),
        ),
    ]),
  );
  if (body.aiSeoEnabled === true) {
    ctx.waitUntil(
      scheduleAiJob(ctx.env.AI_JOB_SCHEDULER, {
        entityTable: "pages",
        entityId: id,
        type: "seo",
        delayMs: 0,
      }),
    );
  }
  invalidatePage(ctx, access.page.projectId, id);
  return result[0];
});

export const deletePage = Effect.fn("pages.deletePage")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof deletePageInput>,
) {
  const user = yield* requireUser(ctx);
  const { id } = yield* decodeInput(deletePageInput, rawInput);
  const access = yield* assertPageAccess(ctx.db, id, user.id);

  const result = yield* Effect.promise(() =>
    ctx.db.delete(pages).where(eq(pages.id, id)).returning().get(),
  );
  invalidatePage(ctx, access.page.projectId, id);
  return result;
});

export const setPageAiSeo = Effect.fn("pages.setPageAiSeo")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof setPageAiSeoInput>,
) {
  const user = yield* requireUser(ctx);
  const { id, enabled } = yield* decodeInput(setPageAiSeoInput, rawInput);
  const access = yield* assertPageAccess(ctx.db, id, user.id);

  const result = yield* Effect.promise(() =>
    ctx.db
      .update(pages)
      .set({ aiSeoEnabled: enabled, updatedAt: sql`max(${pages.updatedAt} + 1, ${Date.now()})` })
      .where(eq(pages.id, id))
      .returning()
      .get(),
  );
  if (enabled) {
    ctx.waitUntil(
      scheduleAiJob(ctx.env.AI_JOB_SCHEDULER, {
        entityTable: "pages",
        entityId: id,
        type: "seo",
        delayMs: 0,
      }),
    );
  }
  invalidatePage(ctx, access.page.projectId, id);
  return result;
});

export const setPageMetaTitle = Effect.fn("pages.setPageMetaTitle")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof setPageMetaTitleInput>,
) {
  const user = yield* requireUser(ctx);
  const { id, metaTitle } = yield* decodeInput(setPageMetaTitleInput, rawInput);
  const access = yield* assertPageAccess(ctx.db, id, user.id);

  const result = yield* Effect.promise(() =>
    ctx.db
      .update(pages)
      .set({ metaTitle, updatedAt: Date.now() })
      .where(eq(pages.id, id))
      .returning()
      .get(),
  );
  invalidatePage(ctx, access.page.projectId, id);
  return result;
});

export const setPageMetaDescription = Effect.fn("pages.setPageMetaDescription")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof setPageMetaDescriptionInput>,
) {
  const user = yield* requireUser(ctx);
  const { id, metaDescription } = yield* decodeInput(setPageMetaDescriptionInput, rawInput);
  const access = yield* assertPageAccess(ctx.db, id, user.id);

  const result = yield* Effect.promise(() =>
    ctx.db
      .update(pages)
      .set({ metaDescription, updatedAt: Date.now() })
      .where(eq(pages.id, id))
      .returning()
      .get(),
  );
  invalidatePage(ctx, access.page.projectId, id);
  return result;
});

export const setPageLayout = Effect.fn("pages.setPageLayout")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof setPageLayoutInput>,
) {
  const user = yield* requireUser(ctx);
  const { id, layoutId } = yield* decodeInput(setPageLayoutInput, rawInput);
  const access = yield* assertPageAccess(ctx.db, id, user.id);
  yield* assertCuratedLayout(ctx, access.page.environmentId, layoutId);

  const result = yield* Effect.promise(() =>
    ctx.db
      .update(pages)
      .set({ layoutId, updatedAt: Date.now() })
      .where(eq(pages.id, id))
      .returning()
      .get(),
  );
  invalidatePage(ctx, access.page.projectId, id);
  return result;
});

export const generatePageSeo = Effect.fn("pages.generatePageSeo")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof generatePageSeoInput>,
) {
  const user = yield* requireUser(ctx);
  const { id } = yield* decodeInput(generatePageSeoInput, rawInput);
  const access = yield* assertPageAccess(ctx.db, id, user.id);

  yield* executePageSeo(ctx.db, ctx.env.OPEN_ROUTER_API_KEY, id);
  invalidatePage(ctx, access.page.projectId, id);
  const updated = yield* Effect.promise(() =>
    ctx.db.select().from(pages).where(eq(pages.id, id)).get(),
  );
  return updated;
});
