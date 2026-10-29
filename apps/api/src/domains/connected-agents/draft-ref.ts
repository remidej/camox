import { DRAFT_SEARCH_PARAM, type DraftOutcome } from "@camox/api-contract/drafts";
import { uuidv7Schema } from "@camox/api-contract/ids";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { z } from "zod";

import { drafts, endedDrafts } from "../drafts/schema";
import { findEndedDraft } from "../drafts/service";
import type { MemberProject } from "./member";
import type { ConnectedAgentCall } from "./routes";

/** The argument of tools that name a draft: its id, or a studio link to it. */
export const draftArgument = z
  .string()
  .describe(
    "The draft: its id, or a studio link to it (a link to the website with a `camox-draft` parameter).",
  );

/** An open draft a Connected Agent's member can see, with the project it belongs to. */
export type ReachedDraft = {
  id: string;
  name: string | null;
  project: MemberProject;
};

/**
 * The draft's id a Connected Agent names: the id itself, or the `camox-draft` parameter of a
 * studio link (ADR 0011). Undefined when it names none.
 */
function draftIdNamedBy(ref: string) {
  const named = ref.trim();
  if (uuidv7Schema.safeParse(named).success) return named;
  if (!URL.canParse(named)) return undefined;
  const id = new URL(named).searchParams.get(DRAFT_SEARCH_PARAM);
  return id && uuidv7Schema.safeParse(id).success ? id : undefined;
}

/** How a draft a Connected Agent names ended: published or deleted, by whom and when. */
export type DraftEnd = { outcome: DraftOutcome; endedBy: string; endedAt: number };

/**
 * The draft a Connected Agent names by id or studio link, among those its member can see, open
 * or ended, or why it can't have it. The draft implies its project, so tools naming one need no
 * project.
 */
export async function openOrEndedDraft(
  call: ConnectedAgentCall,
  ref: string,
): Promise<{ draft: ReachedDraft; ended?: DraftEnd } | { refusal: string }> {
  const id = draftIdNamedBy(ref);
  if (!id) {
    return {
      refusal: `"${ref}" names no draft: give a draft's id, or a studio link to it, which carries a \`${DRAFT_SEARCH_PARAM}\` parameter.`,
    };
  }
  const [open, ended] = await Promise.all([
    call.db
      .select({ name: drafts.name, projectId: drafts.projectId })
      .from(drafts)
      .where(eq(drafts.id, id))
      .get(),
    call.db
      .select({ name: endedDrafts.name, projectId: endedDrafts.projectId })
      .from(endedDrafts)
      .where(eq(endedDrafts.id, id))
      .get(),
  ]);
  const found = open ?? ended;
  const project = found && call.member.projects.find(({ id }) => id === found.projectId);
  // A draft of a project the member can't reach reads as one that doesn't exist.
  if (!found || !project) return { refusal: `No draft you can see has the id ${id}.` };
  const draft = { id, name: found.name, project };
  if (open) return { draft };
  // Found among ended drafts, so it's there: an ended draft never comes back.
  const how = (await Effect.runPromise(findEndedDraft(call.db, project.id, id)))!;
  return {
    draft,
    ended: { outcome: how.outcome, endedBy: how.endedBy.name, endedAt: how.endedAt },
  };
}

/**
 * The open draft a Connected Agent names by id or studio link, among those its member can see,
 * or why it can't have it: a draft that ended is refused, saying how.
 */
export async function openDraft(
  call: ConnectedAgentCall,
  ref: string,
): Promise<{ draft: ReachedDraft } | { refusal: string }> {
  const seen = await openOrEndedDraft(call, ref);
  if ("refusal" in seen || !seen.ended) return seen;
  const { draft, ended } = seen;
  const named = draft.name ? `The draft "${draft.name}"` : `The draft ${draft.id}`;
  const when = new Date(ended.endedAt).toISOString().slice(0, 10);
  return {
    refusal: `${named} has ended: ${ended.endedBy} ${ended.outcome} it on ${when}. Its changes ${ended.outcome === "published" ? "are on Live" : "are gone"}; start a new draft to change the website further.`,
  };
}
