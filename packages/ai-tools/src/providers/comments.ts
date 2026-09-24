import { ORPCError } from "@orpc/server";
import { and, eq } from "drizzle-orm";

import {
  listComments,
  listCommentsInput,
  setCommentResolved,
  setCommentResolvedInput,
} from "../../../../apps/api/src/domains/comments/service";
import { pages } from "../../../../apps/api/src/schema";
import type { ToolDefinition, ToolProvider } from "../types";

async function assertProjectPage(ctx: Parameters<ToolProvider>[0], pageId: number) {
  const page = await ctx.db
    .select({ id: pages.id })
    .from(pages)
    .where(and(eq(pages.id, pageId), eq(pages.projectId, ctx.projectId)))
    .get();
  if (!page) throw new ORPCError("NOT_FOUND");
}

const resolveInput = setCommentResolvedInput.omit({ resolved: true });

export const commentsProvider: ToolProvider = (ctx): ToolDefinition[] => [
  {
    name: "listComments",
    description:
      "List comments on a page in the selected environment, including resolved comments.",
    inputSchema: listCommentsInput,
    meta: { kind: "read", risk: "safe", surfaces: ["cli"] },
    handler: async (input) => {
      const parsed = listCommentsInput.parse(input);
      await assertProjectPage(ctx, parsed.pageId);
      return listComments(ctx, parsed);
    },
  },
  {
    name: "resolveComment",
    description: "Resolve a comment on a page in the selected environment.",
    inputSchema: resolveInput,
    meta: { kind: "write", risk: "requiresApproval", surfaces: ["cli"] },
    handler: async (input) => {
      const parsed = resolveInput.parse(input);
      await assertProjectPage(ctx, parsed.pageId);
      return setCommentResolved(ctx, { ...parsed, resolved: true });
    },
  },
];
