import { and, eq } from "drizzle-orm";

import type { Database } from "../../db";
import type { Bindings } from "../../types";
import { drafts } from "../drafts/schema";
import { projects } from "../projects/schema";
import { revisions } from "../revisions/schema";

/** What an upload ahead that failed logs: the publish uploads the script itself then. */
export const notUploadedAhead = (error: unknown) =>
  console.warn("A draft's publish script wasn't uploaded ahead of its publish", error);

/**
 * Has the draft `draftId` upload the build of its revision `revisionId` as its publish script,
 * ahead of its publish (`DraftCode.prepareUpload`), as the review of a draft with code opens.
 * Never fails: a revision whose build isn't stored, or an upload that fails, leaves the upload
 * to the publish.
 */
export async function uploadAhead(
  env: Pick<Bindings, "DRAFT_CODE">,
  db: Database,
  { draftId, revisionId }: { draftId: string; revisionId: string },
) {
  try {
    const revision = await db
      .select({ project: projects.uuid, archiveKey: revisions.archiveKey })
      .from(revisions)
      .innerJoin(drafts, eq(drafts.id, revisions.draftId))
      .innerJoin(projects, eq(projects.id, drafts.projectId))
      .where(and(eq(revisions.id, revisionId), eq(revisions.draftId, draftId)))
      .get();
    if (!revision?.archiveKey) return;
    await env.DRAFT_CODE.getByName(draftId).prepareUpload({
      project: revision.project,
      revision: revisionId,
      archiveKey: revision.archiveKey,
    });
  } catch (error) {
    notUploadedAhead(error);
  }
}
