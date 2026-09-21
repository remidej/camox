import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { pageSourceSchema } from "../../../../apps/api/src/domains/_shared/page-source";
import { getPageMarkdown } from "../../../../apps/api/src/domains/blocks/service";
import {
  createPage,
  createPageInput,
  deletePage,
  deletePageInput,
  discardPageChanges,
  getPage,
  listPages,
  publishPage,
  setPageLayout,
  setPageLayoutInput,
  setPageMetaDescription,
  setPageMetaDescriptionInput,
  setPageMetaTitle,
  setPageMetaTitleInput,
  unpublishPage,
  updatePage,
  updatePageInput,
} from "../../../../apps/api/src/domains/pages/service";
import { resolveEnvironment } from "../../../../apps/api/src/lib/resolve-environment";
import type { ToolDefinition, ToolProvider } from "../types";

const listPagesToolInput = z.object({});
const createPageToolInput = createPageInput.omit({ projectId: true });
// `source` defaults to "draft" in the agent / CLI tool — the user is editing
// the working copy unless they explicitly ask for the published version.
const getPageToolInput = z.union([
  z.object({ id: z.number(), source: pageSourceSchema.optional() }),
  z.object({ path: z.string(), source: pageSourceSchema.optional() }),
]);
// Publish accepts either `id` or `path` so the CLI can mirror `pages get`'s
// flags. `alsoPublishLayout` defaults true at the CLI layer; the underlying
// service no-ops when the layout has no pending changes.
const pageMutationTargetInput = z
  .object({
    id: z.number().optional(),
    path: z.string().optional(),
  })
  .refine((d) => (d.id != null) !== (d.path != null), {
    message: "Pass exactly one of `id` or `path`.",
  });

const updatePageToolInput = z
  .object({
    ...updatePageInput.shape,
    id: z.number().optional(),
    path: z.string().optional(),
  })
  .refine((input) => (input.id != null) !== (input.path != null), {
    message: "Pass exactly one of `id` or `path`.",
  });

const publishPageToolInput = pageMutationTargetInput.and(
  z.object({
    alsoPublishLayout: z.boolean().optional(),
  }),
);

async function resolvePageTargetId(
  ctx: Parameters<ToolProvider>[0],
  target: z.infer<typeof pageMutationTargetInput>,
): Promise<number> {
  if (target.id != null) return target.id;
  if (target.path == null) throw new Error("Pass exactly one of `id` or `path`.");

  const page = await getPage(ctx, {
    projectId: ctx.projectId,
    path: target.path,
    source: "draft",
  });
  return page.id;
}

export const pagesProvider: ToolProvider = (ctx): ToolDefinition[] => [
  {
    name: "listPages",
    description: "List all pages in the current project.",
    inputSchema: listPagesToolInput,
    meta: { kind: "read", risk: "safe", surfaces: ["cli"] },
    handler: () => listPages(ctx, { projectId: ctx.projectId }),
  },
  {
    name: "getPage",
    description:
      "Fetch a single page by id or by full path (e.g. `/about`). Returns the page row and an ordered array of its blocks, each with `id`, `position`, and rendered `markdown`. Layout-scoped blocks are not included — use the layouts tools to inspect those. " +
      "Defaults to reading the draft; pass `source: 'live'` to read the published snapshot (errors if the page has never been published).",
    inputSchema: getPageToolInput,
    meta: { kind: "read", risk: "safe", surfaces: ["cli"] },
    handler: async (input) => {
      const parsed = getPageToolInput.parse(input);
      const source = parsed.source ?? "draft";
      const page =
        "id" in parsed
          ? await getPage(ctx, { id: parsed.id, source })
          : await getPage(ctx, { projectId: ctx.projectId, path: parsed.path, source });
      const { blocks } = await getPageMarkdown(ctx, { pageId: page.id, source });
      return { page, blocks };
    },
  },
  {
    name: "createPage",
    description:
      "Create a new page. `layoutId` is required — call listLayouts to discover available layouts. " +
      "`nickname` is the short internal Studio name for the page. The page starts empty; create blocks explicitly after creating it.",
    inputSchema: createPageToolInput,
    meta: { kind: "write", risk: "safe", surfaces: ["cli"] },
    handler: (input) => {
      const data = createPageToolInput.parse(input);
      return createPage(ctx, { ...data, projectId: ctx.projectId });
    },
  },
  {
    name: "updatePage",
    description:
      "Update a page draft by id or path: internal nickname, pathSegment, parentPageId, metaTitle, metaDescription, or aiSeoEnabled. Manual metadata disables automatic SEO for both fields and cannot be combined with aiSeoEnabled: true. Empty strings clear metadata; omitted fields are preserved. Enabling AI schedules asynchronous generation. Publish separately to update live content.",
    inputSchema: updatePageToolInput,
    meta: { kind: "write", risk: "safe", surfaces: ["cli"] },
    handler: async (input) => {
      const parsed = updatePageToolInput.parse(input);
      const id = await resolvePageTargetId(ctx, parsed);
      const page = await getPage(ctx, { id, source: "draft" });
      const environment = await resolveEnvironment(ctx.db, ctx.projectId, ctx.environmentName);
      if (page.projectId !== ctx.projectId || page.environmentId !== environment.id) {
        throw new ORPCError("NOT_FOUND");
      }
      return updatePage(ctx, { ...parsed, id });
    },
  },
  {
    name: "setPageLayout",
    description: "Change a page's layout. Use listLayouts to discover layout ids.",
    inputSchema: setPageLayoutInput,
    meta: { kind: "write", risk: "safe", surfaces: ["cli"] },
    handler: (input) => setPageLayout(ctx, setPageLayoutInput.parse(input)),
  },
  {
    name: "setPageMetaTitle",
    description: "Set a page's SEO meta title.",
    inputSchema: setPageMetaTitleInput,
    meta: { kind: "write", risk: "safe", surfaces: ["cli"] },
    handler: (input) => setPageMetaTitle(ctx, setPageMetaTitleInput.parse(input)),
  },
  {
    name: "setPageMetaDescription",
    description: "Set a page's SEO meta description.",
    inputSchema: setPageMetaDescriptionInput,
    meta: { kind: "write", risk: "safe", surfaces: ["cli"] },
    handler: (input) => setPageMetaDescription(ctx, setPageMetaDescriptionInput.parse(input)),
  },
  {
    name: "deletePage",
    description: "Delete a page by id. The blocks on the page are deleted as well.",
    inputSchema: deletePageInput,
    meta: { kind: "write", risk: "requiresApproval", surfaces: ["cli"] },
    handler: (input) => deletePage(ctx, deletePageInput.parse(input)),
  },
  {
    name: "publishPage",
    description:
      "Promote the page's current draft to live. Accepts either `id` or `path` (e.g. `/about`). " +
      "Pass `alsoPublishLayout: true` (default behavior in the CLI's `pages publish`) to bundle the page's layout into the same publish — a no-op when the layout has no pending changes.",
    inputSchema: publishPageToolInput,
    meta: { kind: "write", risk: "requiresApproval", surfaces: ["cli"] },
    handler: async (input) => {
      const parsed = publishPageToolInput.parse(input);
      const id = await resolvePageTargetId(ctx, parsed);
      return publishPage(ctx, { id, alsoPublishLayout: parsed.alsoPublishLayout });
    },
  },
  {
    name: "unpublishPage",
    description:
      "Remove the page's live published snapshot pointer so public/live reads stop serving it. " +
      "The draft is left untouched. Accepts either `id` or `path` (e.g. `/about`).",
    inputSchema: pageMutationTargetInput,
    meta: { kind: "write", risk: "requiresApproval", surfaces: ["cli"] },
    handler: async (input) => {
      const parsed = pageMutationTargetInput.parse(input);
      const id = await resolvePageTargetId(ctx, parsed);
      return unpublishPage(ctx, { id });
    },
  },
  {
    name: "discardPageChanges",
    description:
      "Reset the page draft to the currently published live snapshot. This does not change live content and fails if the page has never been published. " +
      "Accepts either `id` or `path` (e.g. `/about`).",
    inputSchema: pageMutationTargetInput,
    meta: { kind: "write", risk: "requiresApproval", surfaces: ["cli"] },
    handler: async (input) => {
      const parsed = pageMutationTargetInput.parse(input);
      const id = await resolvePageTargetId(ctx, parsed);
      return discardPageChanges(ctx, { id });
    },
  },
];
