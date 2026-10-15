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
  setPageMetaDescription,
  setPageMetaDescriptionInput,
  setPageMetaTitle,
  setPageMetaTitleInput,
  updatePage,
  updatePageInput,
} from "../../../../apps/api/src/domains/pages/service";
import { NotFoundError } from "../../../../apps/api/src/lib/errors";
import { resolveEnvironment } from "../../../../apps/api/src/lib/resolve-environment";
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
  {
    name: "listPages",
    description: "List all pages in the current project.",
    inputSchema: listPagesToolInput,
    meta: { kind: "read", risk: "safe", surfaces: ["cli"] },
    handler: async () => runService(listPages(ctx, { projectId: ctx.projectId })),
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
          const page = yield* getPage(
            ctx,
            "id" in parsed ? { id: parsed.id } : { projectId: ctx.projectId, path: parsed.path },
          );
          const scope = yield* resolveDraftScope(ctx, ctx.projectId);
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
      return runService(createPage(ctx, { ...data, projectId: ctx.projectId }));
    },
  },
  {
    name: "updatePage",
    description:
      "Update a page by id or path: internal nickname, pathSegment, parentPageId, metaTitle, metaDescription, or aiSeoEnabled. Manual metadata disables automatic SEO for both fields and cannot be combined with aiSeoEnabled: true. Empty strings clear metadata; omitted fields are preserved. Enabling AI schedules asynchronous generation.",
    inputSchema: updatePageToolInput,
    meta: { kind: "write", risk: "safe", surfaces: ["cli"] },
    handler: async (input) => {
      const parsed = updatePageToolInput.parse(input);
      return runService(
        Effect.gen(function* () {
          const id = yield* resolvePageTargetId(ctx, parsed);
          const page = yield* getPage(ctx, { id });
          const environment = yield* resolveEnvironment(ctx.db, ctx.projectId, ctx.environmentName);
          if (page.projectId !== ctx.projectId || page.environmentId !== environment.id) {
            return yield* new NotFoundError();
          }
          return yield* updatePage(ctx, { ...parsed, id });
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
    handler: async (input) => runService(setPageLayout(ctx, setPageLayoutInput.parse(input))),
  },
  {
    name: "setPageMetaTitle",
    description: "Set a page's SEO meta title.",
    inputSchema: setPageMetaTitleInput,
    meta: { kind: "write", risk: "safe", surfaces: ["cli"] },
    handler: async (input) => runService(setPageMetaTitle(ctx, setPageMetaTitleInput.parse(input))),
  },
  {
    name: "setPageMetaDescription",
    description: "Set a page's SEO meta description.",
    inputSchema: setPageMetaDescriptionInput,
    meta: { kind: "write", risk: "safe", surfaces: ["cli"] },
    handler: async (input) =>
      runService(setPageMetaDescription(ctx, setPageMetaDescriptionInput.parse(input))),
  },
  {
    name: "deletePage",
    description: "Delete a page by id. The blocks on the page are deleted as well.",
    inputSchema: deletePageInput,
    meta: { kind: "write", risk: "requiresApproval", surfaces: ["cli"] },
    handler: async (input) => runService(deletePage(ctx, deletePageInput.parse(input))),
  },
];
