import { and, eq } from "drizzle-orm";
import { Effect } from "effect";

import {
  listComments,
  listCommentsInput,
  setCommentResolved,
  setCommentResolvedInput,
} from "../../../../apps/api/src/domains/comments/service";
import { NotFoundError } from "../../../../apps/api/src/lib/errors";
import { runService } from "../../../../apps/api/src/lib/run-service";
import { pages } from "../../../../apps/api/src/schema";
import type { ToolDefinition, ToolProvider } from "../types";

const assertProjectPage = Effect.fn("assertProjectPage")(function* (
  ctx: Parameters<ToolProvider>[0],
  pageId: number,
) {
  const page = yield* Effect.promise(() =>
    ctx.db
      .select({ id: pages.id })
      .from(pages)
      .where(and(eq(pages.id, pageId), eq(pages.projectId, ctx.projectId)))
      .get(),
  );
  if (!page) return yield* new NotFoundError();
});

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
      return runService(
        assertProjectPage(ctx, parsed.pageId).pipe(Effect.andThen(listComments(ctx, parsed))),
      );
    },
  },
  {
    name: "resolveComment",
    description: "Resolve a comment on a page in the selected environment.",
    inputSchema: resolveInput,
    meta: { kind: "write", risk: "requiresApproval", surfaces: ["cli"] },
    handler: async (input) => {
      const parsed = resolveInput.parse(input);
      return runService(
        assertProjectPage(ctx, parsed.pageId).pipe(
          Effect.andThen(setCommentResolved(ctx, { ...parsed, resolved: true })),
        ),
      );
    },
  },
];
