import { uuidv7Schema } from "@camox/api-contract/ids";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { z } from "zod";

import { ConflictError, decodeInput, InvalidInputError, NotFoundError } from "../../lib/errors";
import { blocks, layouts, pages, projects, user } from "../../schema";
import { definitionsIn } from "../_shared/definitions";
import type { ServiceContext } from "../_shared/service-context";
import { type BlockBundle, contentReader } from "../content/reader";
import { accessTo } from "../drafts/access";
import * as overlay from "../drafts/overlay";
import type { Draft, DraftScope } from "../drafts/scope";
import { type GenerationDeps, homeOf, requestGeneration } from "../generated-values/service";
import { blocksOfLayout, layoutNamed } from "../layouts/identity";
import {
  assertCuratedLayout,
  assertUnreservedPagePaths,
  pageServingProblems,
  servesPages,
} from "../layouts/route-ownership";
import { executePageSeo } from "./ai";
import { duplicatePathIds } from "./duplicate-paths";
import { type PageView, seoGenerated } from "./generated-seo";

const { sortByPosition } = overlay;

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
  z.object({ id: uuidv7Schema }),
  z.object({ projectId: z.number(), path: z.string() }),
]);

/** The server mints the id; a client may mint one for an optimistic insert. */
export const createPageInput = z.object({
  id: uuidv7Schema.optional(),
  projectId: z.number(),
  nickname: pageNicknameSchema.optional(),
  pathSegment: z.string(),
  parentPageId: uuidv7Schema.optional(),
  /** The name of the page's layout. */
  layoutId: z.string(),
});
export const updatePageInput = z
  .object({
    id: uuidv7Schema,
    nickname: pageNicknameSchema.optional(),
    pathSegment: z.string().optional(),
    parentPageId: uuidv7Schema.nullable().optional(),
  })
  .refine(({ id: _id, ...fields }) => Object.values(fields).some((value) => value !== undefined), {
    message: "Pass at least one field to update.",
  });
export const deletePageInput = z.object({ id: uuidv7Schema });
/**
 * A page's meta title and description are one group, all generated or all manual (ADR 0012).
 * Writing either field makes the group manual, copying the generated value into the other one;
 * `aiSeo: true` makes it generated again, `aiSeo: false` makes it manual as shown.
 */
export const setPageSeoInput = z
  .object({
    id: uuidv7Schema,
    metaTitle: z.string().optional(),
    metaDescription: z.string().optional(),
    aiSeo: z.boolean().optional(),
  })
  .refine(
    (input) =>
      input.metaTitle !== undefined ||
      input.metaDescription !== undefined ||
      input.aiSeo !== undefined,
    { message: "Pass a meta title, a meta description or an AI SEO setting." },
  )
  .refine(
    (input) =>
      input.aiSeo !== true ||
      (input.metaTitle === undefined && input.metaDescription === undefined),
    { message: "Cannot enable automatic SEO alongside manual metadata." },
  );
/** `layoutId` names the page's new layout. */
export const setPageLayoutInput = z.object({ id: uuidv7Schema, layoutId: z.string() });
export const generatePageSeoInput = z.object({ id: uuidv7Schema });
// --- Reads ---
//
// Pages are read and written in the request's draft scope through the draft overlay (ADR 0005):
// a draft shows its own pages over Live's, minus the ones it deleted.

/** The pages of a project as a scope reads them. */
const pagesIn = (ctx: ServiceContext, scope: DraftScope, projectId: number) =>
  overlay.select(ctx.db, scope, pages, eq(pages.projectId, projectId));

/** A page as readers see it, with the SEO in effect (ADR 0012). */
const shownPage = Effect.fn("pages.shownPage")(function* <P extends typeof pages.$inferSelect>(
  ctx: ServiceContext,
  scope: DraftScope,
  row: P,
) {
  return (yield* contentReader(ctx, { projectId: row.projectId, draft: scope }).shown.pages([
    row,
  ]))[0]!;
});

/** The page at a path in the project, with its project and layout. */
const findPageByPath = Effect.fn("pages.findPageByPath")(function* (
  ctx: ServiceContext,
  project: typeof projects.$inferSelect,
  fullPath: string,
  scope: DraftScope,
) {
  const [page] = yield* overlay.select(
    ctx.db,
    scope,
    pages,
    and(eq(pages.fullPath, fullPath), eq(pages.projectId, project.id)),
  );
  if (!page) return yield* new NotFoundError();
  const layout =
    (yield* Effect.promise(() =>
      ctx.db
        .select()
        .from(layouts)
        .where(and(layoutNamed(page.projectId, page.layoutId), definitionsIn(layouts, scope)))
        .get(),
    )) ?? null;
  // A page whose layout was removed or is no longer curated isn't served (ADR 0007).
  if (!servesPages(layout)) return yield* new NotFoundError();
  return { project, page, layout };
});

function layoutView(
  layout: typeof layouts.$inferSelect | null,
  layoutBlocks: { id: string; slot: "before" | "after" | null }[],
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

/** A page's view: its blocks, then its layout's, each followed by their items in order. */
function composePageView(args: {
  page: PageView;
  project: typeof projects.$inferSelect;
  layout: typeof layouts.$inferSelect | null;
  content: BlockBundle;
}) {
  const { page, project, layout, content } = args;
  const pageBlocks = content.blocks.filter((block) => block.pageId === page.id);
  const layoutBlocks = content.blocks.filter((block) => block.pageId !== page.id);
  const itemsByBlock = Map.groupBy(content.repeatableItems, (item) => item.blockId);
  const blocks = [...pageBlocks, ...layoutBlocks];
  return {
    page: { ...page, blockIds: pageBlocks.map((b) => b.id) },
    projectName: project.name,
    // `id` + `updatedAt` are enough for the SDK to build a cache-busted
    // favicon URL (`/favicons/${id}?v=${updatedAt}`) in the page <head>.
    project: { id: project.id, updatedAt: project.updatedAt },
    layout: layoutView(layout, layoutBlocks),
    blocks,
    repeatableItems: blocks.flatMap((block) => itemsByBlock.get(block.id) ?? []),
    files: content.files,
  };
}

export const getPageByPath = Effect.fn("pages.getPageByPath")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof getPageByPathInput>,
) {
  const { path, projectSlug } = yield* decodeInput(getPageByPathInput, rawInput);
  const access = yield* accessTo(ctx, { projectSlug }, "public");
  const { scope } = access;
  const { project, page: stored, layout } = yield* findPageByPath(ctx, access.project, path, scope);
  const reader = contentReader(ctx, { projectId: project.id, draft: scope });
  const [page] = yield* reader.shown.pages([stored]);
  const content = yield* reader.blocks([
    { pageId: page!.id },
    ...(layout ? [{ layoutId: layout.layoutId }] : []),
  ]);
  return composePageView({ page: page!, project, layout, content });
}, Effect.scoped);

export const getPageStructure = Effect.fn("pages.getPageStructure")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof getPageStructureInput>,
) {
  const { path, projectSlug } = yield* decodeInput(getPageStructureInput, rawInput);
  const access = yield* accessTo(ctx, { projectSlug }, "public");
  const { scope } = access;
  const { project, page: stored, layout } = yield* findPageByPath(ctx, access.project, path, scope);
  const page = yield* shownPage(ctx, scope, stored);

  const pageBlockOrder = sortByPosition(
    yield* overlay.select(ctx.db, scope, blocks, eq(blocks.pageId, page.id)),
  );
  const layoutBlockOrder = layout
    ? sortByPosition(yield* overlay.select(ctx.db, scope, blocks, blocksOfLayout(layout)))
    : [];

  return {
    page: { ...page, blockIds: pageBlockOrder.map((b) => b.id) },
    projectName: project.name,
    project: { id: project.id, updatedAt: project.updatedAt },
    layout: layoutView(layout, layoutBlockOrder),
  };
}, Effect.scoped);

/**
 * Pages with what keeps them from being served or published: no layout, a singleton serving
 * their URL, or another page with the same path in the scope (ADR 0009).
 */
const withPageProblems = Effect.fn("pages.withPageProblems")(function* (
  ctx: ServiceContext,
  projectId: number,
  scope: DraftScope,
  rows: PageView[],
) {
  const problems = yield* pageServingProblems(ctx, projectId, scope);
  const duplicates = duplicatePathIds(rows);
  return rows.map((page) => ({
    ...page,
    ...problems(page),
    duplicatePath: duplicates.has(page.id),
  }));
});

export const listPages = Effect.fn("pages.listPages")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof listPagesInput>,
) {
  const { projectId } = yield* decodeInput(listPagesInput, rawInput);
  const { scope } = yield* accessTo(ctx, { project: projectId }, "public");
  const rows = (yield* pagesIn(ctx, scope, projectId)).filter(
    (page) => page.projectId === projectId,
  );
  return yield* withPageProblems(
    ctx,
    projectId,
    scope,
    yield* contentReader(ctx, { projectId, draft: scope }).shown.pages(rows),
  );
}, Effect.scoped);

export const listPagesBySlug = Effect.fn("pages.listPagesBySlug")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof listPagesBySlugInput>,
) {
  const { projectSlug } = yield* decodeInput(listPagesBySlugInput, rawInput);
  const { scope, project } = yield* accessTo(ctx, { projectSlug }, "public");
  const rows = (yield* pagesIn(ctx, scope, project.id)).filter(
    (page) => page.projectId === project.id,
  );
  return yield* withPageProblems(
    ctx,
    project.id,
    scope,
    yield* contentReader(ctx, { projectId: project.id, draft: scope }).shown.pages(rows),
  );
}, Effect.scoped);

export const getPage = Effect.fn("pages.getPage")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof getPageInput>,
) {
  const parsed = yield* decodeInput(getPageInput, rawInput);
  const ref = "id" in parsed ? { page: parsed.id } : { project: parsed.projectId };
  const { scope } = yield* accessTo(ctx, ref, "member");
  let row: typeof pages.$inferSelect | undefined;
  if ("id" in parsed) {
    row = yield* overlay.get(ctx.db, scope, pages, parsed.id);
  } else {
    [row] = yield* overlay.select(
      ctx.db,
      scope,
      pages,
      and(eq(pages.projectId, parsed.projectId), eq(pages.fullPath, parsed.path)),
    );
  }
  if (!row) return yield* new NotFoundError();
  // A draft holds content of its own project only.
  if (scope && scope.projectId !== row.projectId) return yield* new NotFoundError();
  const createdById = row.createdById;
  const creator = createdById
    ? yield* Effect.promise(() =>
        ctx.db.select({ name: user.name }).from(user).where(eq(user.id, createdById)).get(),
      )
    : undefined;
  const duplicates = duplicatePathIds(yield* pagesIn(ctx, scope, row.projectId));
  return {
    ...(yield* shownPage(ctx, scope, row)),
    createdBy: creator?.name ?? null,
    duplicatePath: duplicates.has(row.id),
  };
}, Effect.scoped);

// --- Writes ---
//
// Every write lands in the request's draft scope. In a draft, the first write to a page copies
// it, and a deletion writes a tombstone; publishing applies them to Live (ADR 0005, 0009).

export const createPage = Effect.fn("pages.createPage")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof createPageInput>,
) {
  const { id, projectId, nickname, pathSegment, parentPageId, layoutId } = yield* decodeInput(
    createPageInput,
    rawInput,
  );
  const { scope, user } = yield* accessTo(ctx, { project: projectId }, "write");

  yield* assertCuratedLayout(ctx, projectId, layoutId, scope);
  let fullPath = `/${pathSegment}`;
  if (parentPageId) {
    const parent = yield* overlay.get(ctx.db, scope, pages, parentPageId);
    if (parent?.projectId !== projectId) return yield* new NotFoundError();
    fullPath = `${parent.fullPath.replace(/\/$/, "")}/${pathSegment}`;
  }
  yield* assertUnreservedPagePaths(ctx, projectId, [fullPath], scope);

  const now = Date.now();
  const page = yield* overlay.insert(ctx.db, scope, pages, {
    id,
    projectId,
    pathSegment,
    fullPath,
    parentPageId: parentPageId ?? null,
    layoutId,
    nickname: nickname ?? deriveDefaultPageNickname(pathSegment),
    contentUpdatedAt: now,
    createdById: user.id,
    createdAt: now,
    updatedAt: now,
  });
  if (!page) return yield* new ConflictError({ message: `Page ${id} already exists` });

  // A new page's SEO is generated: publishing waits for a meta title (ADR 0009).
  yield* requestPageSeo(ctx, scope, page, 0);

  return { page: yield* shownPage(ctx, scope, page), fullPath: page.fullPath };
}, Effect.scoped);

/**
 * Updates a page. Renaming or moving it rewrites the full path of every descendant page, which
 * a draft copies along with the page (ADR 0005).
 */
export const updatePage = Effect.fn("pages.updatePage")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof updatePageInput>,
) {
  const { id, ...body } = yield* decodeInput(updatePageInput, rawInput);
  const { scope, entity: page } = yield* accessTo(ctx, { page: id }, "write");

  const pathChanges = new Map<string, string>();
  if (body.pathSegment !== undefined || body.parentPageId !== undefined) {
    const projectPages = yield* pagesIn(ctx, scope, page.projectId);
    const parentId = body.parentPageId === undefined ? page.parentPageId : body.parentPageId;
    const parent = projectPages.find((page) => page.id === parentId);
    if (parentId != null && !parent) return yield* new NotFoundError();
    // Reject cycles before calculating paths for this page and its descendants.
    let ancestor = parent;
    while (ancestor) {
      if (ancestor.id === id)
        return yield* new InvalidInputError({ message: "A page cannot be its own ancestor" });
      ancestor = projectPages.find((page) => page.id === ancestor!.parentPageId);
    }
    const fullPath = `${parent?.fullPath.replace(/\/$/, "") ?? ""}/${body.pathSegment ?? page.pathSegment}`;
    const visit = (pageId: string, path: string) => {
      pathChanges.set(pageId, path);
      for (const child of projectPages.filter((page) => page.parentPageId === pageId))
        visit(child.id, `${path.replace(/\/$/, "")}/${child.pathSegment}`);
    };
    visit(id, fullPath);
    yield* assertUnreservedPagePaths(ctx, page.projectId, [...pathChanges.values()], scope);
    // Only descendants whose full path changes are rewritten.
    for (const page of projectPages) {
      if (page.id !== id && pathChanges.get(page.id) === page.fullPath) pathChanges.delete(page.id);
    }
  }

  const now = Math.max(Date.now(), page.updatedAt + 1);
  const result = yield* overlay.update(ctx.db, scope, pages, id, {
    ...body,
    fullPath: pathChanges.get(id) ?? page.fullPath,
    updatedAt: now,
  });
  if (!result) return yield* new NotFoundError();
  for (const [pageId, fullPath] of pathChanges) {
    if (pageId === id) continue;
    yield* overlay.update(ctx.db, scope, pages, pageId, { fullPath, updatedAt: now });
  }
  return yield* shownPage(ctx, scope, result);
}, Effect.scoped);

/**
 * Deletes a page in a draft: a tombstone. Publishing deletes the page from Live with its
 * descendants, blocks and repeatable items (ADR 0009).
 */
export const deletePage = Effect.fn("pages.deletePage")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof deletePageInput>,
) {
  const { id } = yield* decodeInput(deletePageInput, rawInput);
  const { scope } = yield* accessTo(ctx, { page: id }, "write");
  const result = yield* overlay.remove(ctx.db, scope, pages, id);
  return result;
}, Effect.scoped);

/** Changes a page's fields in the draft, copying it into the draft on the first write. */
const writePage = Effect.fn("pages.writePage")(function* (
  ctx: ServiceContext,
  scope: Draft,
  page: typeof pages.$inferSelect,
  values: Partial<typeof pages.$inferInsert>,
) {
  const result = yield* overlay.update(ctx.db, scope, pages, page.id, {
    ...values,
    updatedAt: Math.max(Date.now(), page.updatedAt + 1),
  });
  if (!result) return yield* new NotFoundError();
  return result;
});

/**
 * Sets a page's SEO group (ADR 0012): written fields make it manual, copying the generated
 * values into the fields not written; `aiSeo: true` makes it generated again and requests
 * generation.
 */
export const setPageSeo = Effect.fn("pages.setPageSeo")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof setPageSeoInput>,
) {
  const { id, metaTitle, metaDescription, aiSeo } = yield* decodeInput(setPageSeoInput, rawInput);
  const { scope, entity: page } = yield* accessTo(ctx, { page: id }, "write");
  const shown = yield* shownPage(ctx, scope, page);
  const columns =
    aiSeo === true
      ? { metaTitle: null, metaDescription: null }
      : {
          metaTitle: metaTitle ?? shown.metaTitle ?? "",
          metaDescription: metaDescription ?? shown.metaDescription ?? "",
        };
  const result = yield* writePage(ctx, scope, page, columns);
  if (aiSeo === true) yield* requestPageSeo(ctx, scope, result, 0);
  return yield* shownPage(ctx, scope, result);
}, Effect.scoped);

export const setPageLayout = Effect.fn("pages.setPageLayout")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof setPageLayoutInput>,
) {
  const { id, layoutId } = yield* decodeInput(setPageLayoutInput, rawInput);
  const { scope, entity: page } = yield* accessTo(ctx, { page: id }, "write");
  yield* assertCuratedLayout(ctx, page.projectId, layoutId, scope);
  return yield* shownPage(ctx, scope, yield* writePage(ctx, scope, page, { layoutId }));
}, Effect.scoped);

/** Generates a page's SEO now, into the scope's generated values. */
export const generatePageSeo = Effect.fn("pages.generatePageSeo")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof generatePageSeoInput>,
) {
  const { id } = yield* decodeInput(generatePageSeoInput, rawInput);
  const { scope } = yield* accessTo(ctx, { page: id }, "member");

  yield* executePageSeo(ctx.db, ctx.env.OPEN_ROUTER_API_KEY, id, scope);
  const page = yield* overlay.get(ctx.db, scope, pages, id);
  return page ? yield* shownPage(ctx, scope, page) : undefined;
}, Effect.scoped);

/** Requests a page's SEO in the scope, unless it's manual (ADR 0012). */
export const requestPageSeo = Effect.fn("pages.requestPageSeo")(function* (
  ctx: GenerationDeps,
  scope: DraftScope,
  page: typeof pages.$inferSelect,
  delayMs: number,
) {
  if (!seoGenerated(page)) return;
  yield* requestGeneration(ctx, homeOf(scope, page.projectId), {
    entity: "page",
    entityId: page.id,
    delayMs,
  });
});
