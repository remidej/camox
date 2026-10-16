import { uuidv7Schema } from "@camox/api-contract/ids";
import { Effect } from "effect";
import { z } from "zod";

import { getPageMarkdown } from "../../../../apps/api/src/domains/blocks/service";
import { resolveDraftScope } from "../../../../apps/api/src/domains/drafts/service";
import {
  createPage,
  createPageInput,
  deletePage,
  deletePageInput,
  getPage,
  listPages,
  setPageLayout,
  setPageLayoutInput,
  setPageSeo,
  updatePage,
  updatePageInput,
} from "../../../../apps/api/src/domains/pages/service";
import { NotFoundError } from "../../../../apps/api/src/lib/errors";
import { runService } from "../../../../apps/api/src/lib/run-service";
import type { ToolDefinition, ToolProvider } from "../types";

const listPagesToolInput = z.object({});
const createPageToolInput = createPageInput.omit({ projectId: true });
const getPageToolInput = z.union([z.object({ id: uuidv7Schema }), z.object({ path: z.string() })]);
// Mutations accept either `id` or `path` so the CLI can mirror `pages get`'s flags.
const pageMutationTargetInput = z
  .object({
    id: uuidv7Schema.optional(),
    path: z.string().optional(),
  })
  .refine((d) => (d.id != null) !== (d.path != null), {
    message: "Pass exactly one of `id` or `path`.",
  });

const updatePageToolInput = z
  .object({
    ...updatePageInput.shape,
    id: uuidv7Schema.optional(),
    path: z.string().optional(),
  })
  .refine((input) => (input.id != null) !== (input.path != null), {
    message: "Pass exactly one of `id` or `path`.",
  });

const setPageSeoToolInput = z
  .object({
    id: uuidv7Schema.optional(),
    path: z.string().optional(),
    metaTitle: z.string().optional(),
    metaDescription: z.string().optional(),
    aiSeo: z.boolean().optional(),
  })
  .refine((input) => (input.id != null) !== (input.path != null), {
    message: "Pass exactly one of `id` or `path`.",
  });

/** A page of the session's project, by id or path. */
const resolveOwnPage = Effect.fn("resolveOwnPage")(function* (
  ctx: Parameters<ToolProvider>[0],
  target: z.infer<typeof pageMutationTargetInput>,
) {
  const id = yield* resolvePageTargetId(ctx, target);
  const scope = yield* draftScope(ctx);
  const page = yield* getPage(ctx, { id }, scope);
  if (page.projectId !== ctx.projectId) return yield* new NotFoundError();
  return { id, scope };
});

const resolvePageTargetId = Effect.fn("resolvePageTargetId")(function* (
  ctx: Parameters<ToolProvider>[0],
  target: z.infer<typeof pageMutationTargetInput>,
) {
  if (target.id != null) return target.id;
  if (target.path == null)
    return yield* Effect.die(new Error("Pass exactly one of `id` or `path`."));

  const page = yield* getPage(
    ctx,
    { projectId: ctx.projectId, path: target.path },
    yield* draftScope(ctx),
  );
  return page.id;
});

/** Tools read and write pages in the draft the session names, if any. */
const draftScope = (ctx: Parameters<ToolProvider>[0]) => resolveDraftScope(ctx, ctx.projectId);

export const pagesProvider: ToolProvider = (ctx): ToolDefinition[] => [
  {
    name: "listPages",
    description: "List all pages in the current project.",
    inputSchema: listPagesToolInput,
    meta: { kind: "read", risk: "safe", surfaces: ["cli"] },
    handler: async () =>
      runService(
        Effect.flatMap(draftScope(ctx), (scope) =>
          listPages(ctx, { projectId: ctx.projectId }, scope),
        ),
      ),
  },
  {
    name: "getPage",
    description:
      "Fetch a single page by id or by full path (e.g. `/about`). Returns the page row and an ordered array of its blocks, each with `id`, `position`, and rendered `markdown`. Layout-scoped blocks are not included — use the layouts tools to inspect those.",
    inputSchema: getPageToolInput,
    meta: { kind: "read", risk: "safe", surfaces: ["cli"] },
    handler: async (input) => {
      const parsed = getPageToolInput.parse(input);
      return runService(
        Effect.gen(function* () {
          const scope = yield* draftScope(ctx);
          const page = yield* getPage(
            ctx,
            "id" in parsed ? { id: parsed.id } : { projectId: ctx.projectId, path: parsed.path },
            scope,
          );
          const { blocks } = yield* getPageMarkdown(ctx, { pageId: page.id }, scope);
          return { page, blocks };
        }),
      );
    },
  },
  {
    name: "createPage",
    description:
      "Create a new page. `layoutId` is required: the name of a layout, as listed by listLayouts. " +
      "`nickname` is the short internal Studio name for the page. The page starts empty; create blocks explicitly after creating it.",
    inputSchema: createPageToolInput,
    meta: { kind: "write", risk: "safe", surfaces: ["cli"] },
    handler: async (input) => {
      const data = createPageToolInput.parse(input);
      return runService(
        Effect.flatMap(draftScope(ctx), (scope) =>
          createPage(ctx, { ...data, projectId: ctx.projectId }, scope),
        ),
      );
    },
  },
  {
    name: "updatePage",
    description:
      "Update a page by id or path: internal nickname, pathSegment or parentPageId. Omitted fields are preserved. Set SEO with setPageSeo.",
    inputSchema: updatePageToolInput,
    meta: { kind: "write", risk: "safe", surfaces: ["cli"] },
    handler: async (input) => {
      const parsed = updatePageToolInput.parse(input);
      return runService(
        Effect.gen(function* () {
          const { id, scope } = yield* resolveOwnPage(ctx, parsed);
          return yield* updatePage(ctx, { ...parsed, id }, scope);
        }),
      );
    },
  },
  {
    name: "setPageLayout",
    description:
      "Change a page's layout. `layoutId` is the new layout's name; use listLayouts to discover them.",
    inputSchema: setPageLayoutInput,
    meta: { kind: "write", risk: "safe", surfaces: ["cli"] },
    handler: async (input) =>
      runService(
        Effect.flatMap(draftScope(ctx), (scope) =>
          setPageLayout(ctx, setPageLayoutInput.parse(input), scope),
        ),
      ),
  },
  {
    name: "setPageSeo",
    description:
      "Set a page's SEO by id or path: metaTitle, metaDescription, or both. The two are one group, generated by AI or written by hand: writing either makes both manual, keeping the generated value of the field not written. `aiSeo: true` makes them generated again and schedules asynchronous generation; `aiSeo: false` keeps the values shown as manual. An empty meta title blocks publishing.",
    inputSchema: setPageSeoToolInput,
    meta: { kind: "write", risk: "safe", surfaces: ["cli"] },
    handler: async (input) => {
      const parsed = setPageSeoToolInput.parse(input);
      const { id: _id, path: _path, ...seo } = parsed;
      return runService(
        Effect.gen(function* () {
          const { id, scope } = yield* resolveOwnPage(ctx, parsed);
          return yield* setPageSeo(ctx, { ...seo, id }, scope);
        }),
      );
    },
  },
  {
    name: "deletePage",
    description: "Delete a page by id. The blocks on the page are deleted as well.",
    inputSchema: deletePageInput,
    meta: { kind: "write", risk: "requiresApproval", surfaces: ["cli"] },
    handler: async (input) =>
      runService(
        Effect.flatMap(draftScope(ctx), (scope) =>
          deletePage(ctx, deletePageInput.parse(input), scope),
        ),
      ),
  },
];
