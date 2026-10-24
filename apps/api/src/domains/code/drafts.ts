import { eq } from "drizzle-orm";
import { Effect } from "effect";

import type { ServiceContext } from "../_shared/service-context";
import { projects } from "../projects/schema";
import { deleteDraftBuilds } from "../revisions/archive";
import { destroySandbox } from "../revisions/sandbox";

/**
 * Deletes a draft's code as the draft ends, when it has code: its branch and working copy, its
 * builds and its sandbox. The draft ended either way, so this never fails: code it couldn't
 * delete is only reported. Its revisions went with its row.
 */
export const discardCode = Effect.fn("discardCode")(function* (
  ctx: Pick<ServiceContext, "env" | "db">,
  { projectId, draftId }: { projectId: number; draftId: string },
) {
  yield* Effect.promise(async () => {
    const report = (what: string) => (error: unknown) =>
      console.error(`A draft's ${what} wasn't deleted as the draft ended`, error);
    if (
      !(await ctx.env.DRAFT_CODE.getByName(draftId)
        .held()
        .catch(() => true))
    )
      return;
    await ctx.env.DRAFT_CODE.getByName(draftId).discard().catch(report("code"));
    const project = await ctx.db
      .select({ uuid: projects.uuid })
      .from(projects)
      .where(eq(projects.id, projectId))
      .get()
      .catch(report("builds"));
    if (project) {
      await deleteDraftBuilds(ctx.env, { project: project.uuid, draft: draftId }).catch(
        report("builds"),
      );
    }
    await destroySandbox(ctx.env, draftId).catch(report("sandbox"));
  });
});
