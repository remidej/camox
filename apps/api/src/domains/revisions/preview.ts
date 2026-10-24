import { and, desc, eq } from "drizzle-orm";

import type { createDb } from "../../db";
import type { Bindings } from "../../types";
import { drafts } from "../drafts/schema";
import { projects } from "../projects/schema";
import type { RevisionId } from "./result";
import { type RevisionBuildStatus, revisions } from "./schema";

/** What the publish preview says about a draft's code (spec #560, section 10). */
export type PreviewCode = {
  /** The revision the preview shows, the last one that built: null before any did. */
  revision: RevisionId | null;
  /** Whether the draft's code holds the current `main`: false until it merged it. */
  includesLive: boolean;
  /** Whether the draft's latest code changes are still building. */
  building: boolean;
};

/**
 * Where the code of the draft `draftId` stands for publishing it: the preview's `code`, null for
 * a draft whose code no agent changed, and the build status of its head revision, if any.
 */
export async function codeOfDraft(
  env: Bindings,
  db: ReturnType<typeof createDb>,
  draftId: string,
): Promise<{ code: PreviewCode | null; head: RevisionBuildStatus | null }> {
  const working = env.DRAFT_CODE.getByName(draftId);
  const draft = await db
    .select({ head: drafts.headRevisionId, projectUuid: projects.uuid })
    .from(drafts)
    .innerJoin(projects, eq(projects.id, drafts.projectId))
    .where(eq(drafts.id, draftId))
    .get();
  if (!draft || !(await working.held())) return { code: null, head: null };
  const [head, built, building, forkedFrom, main] = await Promise.all([
    draft.head
      ? db
          .select({ buildStatus: revisions.buildStatus })
          .from(revisions)
          .where(eq(revisions.id, draft.head))
          .get()
      : undefined,
    db
      .select({ id: revisions.id })
      .from(revisions)
      .where(and(eq(revisions.draftId, draftId), eq(revisions.buildStatus, "built")))
      .orderBy(desc(revisions.createdAt), desc(revisions.id))
      .get(),
    working.building(),
    working.forkedFrom(),
    env.PROJECT_CODE.getByName(draft.projectUuid).commit(),
  ]);
  return {
    code: {
      revision: built?.id ?? null,
      includesLive: main === undefined || forkedFrom === main,
      building,
    },
    head: head?.buildStatus ?? null,
  };
}
