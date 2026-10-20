import { uuidv7Schema } from "@camox/api-contract/ids";
import { Effect } from "effect";
import { z } from "zod";

import { getPageMarkdown } from "../../../../apps/api/src/domains/blocks/service";
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
import { pageRowSchema, pageSchema } from "../lib/outputs";
import { defineTool, type ToolDefinition, type ToolProvider } from "../types";

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
  const page = yield* getPage(ctx, { id });
  if (page.projectId !== ctx.projectId) return yield* new NotFoundError();
  return id;
});

const resolvePageTargetId = Effect.fn("resolvePageTargetId")(function* (
  ctx: Parameters<ToolProvider>[0],
  target: z.infer<typeof pageMutationTargetInput>,
) {
  if (target.id != null) return target.id;
  if (target.path == null)
    return yield* Effect.die(new Error("Pass exactly one of `id` or `path`."));

  const page = yield* getPage(ctx, { projectId: ctx.projectId, path: target.path });
  return page.id;
});

export const pagesProvider: ToolProvider = (ctx): ToolDefinition[] => [
  defineTool({
    name: "listPages",
    description: "List all pages in the current project.",
    inputSchema: listPagesToolInput,
    outputSchema: z.array(
      pageSchema.extend({
        duplicatePath: z.boolean(),
        needsLayout: z.boolean(),
        shadowed: z.boolean(),
      }),
    ),
    meta: { kind: "read", risk: "safe", surfaces: ["cli"], localized: true },
    handler: async () => runService(listPages(ctx, { projectId: ctx.projectId })),
  }),
  defineTool({
    name: "getPage",
    description:
      "Fetch a single page by id or by full path (e.g. `/about`). Returns the page row and an ordered array of its blocks, each with `id`, `position`, and rendered `markdown`. Layout-scoped blocks are not included — use the layouts tools to inspect those.",
    inputSchema: getPageToolInput,
    outputSchema: z.strictObject({
      page: pageSchema.extend({ createdBy: z.string().nullable(), duplicatePath: z.boolean() }),
      blocks: z.array(
        z.strictObject({ id: z.string(), position: z.string(), markdown: z.string() }),
      ),
    }),
    meta: { kind: "read", risk: "safe", surfaces: ["cli"], localized: true },
    handler: async (input) => {
      const parsed = getPageToolInput.parse(input);
      return runService(
        Effect.gen(function* () {
          const page = yield* getPage(
            ctx,
            "id" in parsed ? { id: parsed.id } : { projectId: ctx.projectId, path: parsed.path },
          );
          const { blocks } = yield* getPageMarkdown(ctx, { pageId: page.id });
          return { page, blocks };
        }),
      );
    },
  }),
  defineTool({
    name: "createPage",
    description:
      "Create a new page. `layoutId` is required: the name of a layout, as listed by listLayouts. " +
      "`nickname` is the short internal Studio name for the page. The page starts empty; create blocks explicitly after creating it.",
    inputSchema: createPageToolInput,
    outputSchema: z.strictObject({ page: pageSchema, fullPath: z.string() }),
    meta: { kind: "write", risk: "safe", surfaces: ["cli"], localized: true },
    handler: async (input) => {
      const data = createPageToolInput.parse(input);
      return runService(createPage(ctx, { ...data, projectId: ctx.projectId }));
    },
  }),
  defineTool({
    name: "updatePage",
    description:
      "Update a page by id or path: internal nickname, pathSegment or parentPageId. Omitted fields are preserved. Set SEO with setPageSeo.",
    inputSchema: updatePageToolInput,
    outputSchema: pageSchema,
    meta: { kind: "write", risk: "safe", surfaces: ["cli"], localized: true },
    handler: async (input) => {
      const parsed = updatePageToolInput.parse(input);
      return runService(
        Effect.gen(function* () {
          const id = yield* resolveOwnPage(ctx, parsed);
          return yield* updatePage(ctx, { ...parsed, id });
        }),
      );
    },
  }),
  defineTool({
    name: "setPageLayout",
    description:
      "Change a page's layout. `layoutId` is the new layout's name; use listLayouts to discover them.",
    inputSchema: setPageLayoutInput,
    outputSchema: pageSchema,
    meta: { kind: "write", risk: "safe", surfaces: ["cli"], localized: true },
    handler: async (input) => runService(setPageLayout(ctx, setPageLayoutInput.parse(input))),
  }),
  defineTool({
    name: "setPageSeo",
    description:
      "Set a page's SEO by id or path: metaTitle, metaDescription, or both. The two are one group, generated by AI or written by hand: writing either makes both manual, keeping the generated value of the field not written. `aiSeo: true` makes them generated again and schedules asynchronous generation; `aiSeo: false` keeps the values shown as manual. An empty meta title blocks publishing.",
    inputSchema: setPageSeoToolInput,
    outputSchema: pageSchema,
    meta: { kind: "write", risk: "safe", surfaces: ["cli"], localized: true },
    handler: async (input) => {
      const parsed = setPageSeoToolInput.parse(input);
      const { id: _id, path: _path, ...seo } = parsed;
      return runService(
        Effect.gen(function* () {
          const id = yield* resolveOwnPage(ctx, parsed);
          return yield* setPageSeo(ctx, { ...seo, id });
        }),
      );
    },
  }),
  defineTool({
    name: "deletePage",
    description: "Delete a page by id. The blocks on the page are deleted as well.",
    inputSchema: deletePageInput,
    outputSchema: pageRowSchema.optional(),
    meta: { kind: "write", risk: "requiresApproval", surfaces: ["cli"], localized: true },
    handler: async (input) => runService(deletePage(ctx, deletePageInput.parse(input))),
  }),
];
