import { DRAFT_SEARCH_PARAM } from "@camox/api-contract/drafts";
import { localizedPath } from "@camox/api-contract/locales";
import { projectWebsiteUrl } from "@camox/api-contract/projects";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { Effect } from "effect";

import { runService } from "../../lib/run-service";
import type { ServiceContext } from "../_shared/service-context";
import { computePreview, requireDraft } from "../drafts/publish";
import { findEndedDraft } from "../drafts/service";
import type { TurnOutcome, TurnPage } from "../threads/turn-end";
import type { MemberProject } from "./member";
import type { ConnectedAgentCall } from "./routes";
import { memberServiceContext, toolAnswer } from "./tools";
import { pagesAndLocales } from "./website";

/**
 * How long a Connected Agent's call waits for the agent's turn to end, below the timeouts common
 * clients give a tool call: past it, the call answers that the agent is still working.
 */
export const TURN_WAIT_MS = 45_000;

/** The message the turn's call waits on: the one the Connected Agent just sent to the draft. */
export type AwaitedTurn = {
  project: MemberProject;
  draftId: string;
  threadId: string;
  /** The operation id the message was sent to the draft's thread with. */
  operationId: string;
};

/**
 * Waits for the turn the Connected Agent's message started or joined in a draft's thread to end,
 * and answers how it went (ADR 0030): the agent's final message, a failure, or the editor who
 * stopped it, with a studio link to the draft on the page the turn changed, or its home page,
 * and the draft's Blockers. Past the wait, it answers that the agent is still working, with the
 * draft's id, and the turn carries on. `start_draft` and `send_message` both answer with it.
 */
export async function answerWithTurn(
  call: ConnectedAgentCall,
  awaited: AwaitedTurn,
): Promise<CallToolResult> {
  const { project, draftId, threadId, operationId } = awaited;
  const waitMs = Number(call.env.CONNECTED_AGENT_TURN_WAIT_MS ?? TURN_WAIT_MS);
  const outcome: TurnOutcome = await call.env.THREAD.getByName(threadId)
    .turnOf(operationId, waitMs)
    // An object restarting mid-wait, as a deploy does, drops the wait, not the turn.
    .catch((error: unknown): TurnOutcome => {
      console.warn("A Connected Agent's call stopped waiting on a turn", error);
      return { turn: "working" };
    });
  if (outcome.turn === "working") {
    return toolAnswer({
      draft: draftId,
      turn: "stillWorking",
      note: "Camox's agent is still working on it. Check on the draft later with get_draft.",
    });
  }
  if (outcome.turn === "threadEnded") {
    const ended = await runService(findEndedDraft(call.db, project.id, draftId));
    return toolAnswer({
      draft: draftId,
      turn: "draftEnded",
      ...(ended && { outcome: ended.outcome, endedBy: ended.endedBy.name }),
    });
  }
  const ctx = memberServiceContext(call, draftId);
  const [studioLink, blockers] = await Promise.all([
    studioLinkOf(ctx, project, draftId, outcome.page),
    blockersOf(ctx, project.id),
  ]);
  const { page: _page, ...end } = outcome;
  return toolAnswer({
    draft: draftId,
    ...(end.turn === "stopped" ? { turn: end.turn, stoppedBy: end.stoppedBy.name } : end),
    studioLink,
    blockers,
  });
}

/**
 * The studio's link to the draft on `page`, in the Locale the turn changed it in, or on the
 * website's home page. The studio runs on the website itself, and the link names the draft.
 */
async function studioLinkOf(
  ctx: ServiceContext,
  project: AwaitedTurn["project"],
  draftId: string,
  page: TurnPage | undefined,
) {
  let path = "/";
  if (page) {
    const { pages, locales } = await pagesAndLocales(ctx, project.id);
    const found = pages.find(({ id }) => id === page.pageId);
    const locale = locales.find(({ tag }) => tag === page.locale);
    if (found) path = locale ? localizedPath(found.fullPath, locale) : found.fullPath;
  }
  const url = new URL(path, projectWebsiteUrl(project));
  url.searchParams.set(DRAFT_SEARCH_PARAM, draftId);
  return url.href;
}

/** The draft's Blockers, as the member reads them, each with the page it's on, if any. */
export async function blockersOf(ctx: ServiceContext, projectId: number) {
  const { blockers } = await runService(
    Effect.gen(function* () {
      return yield* computePreview(ctx, yield* requireDraft(ctx, projectId));
    }),
  );
  return blockers.map(({ message, owner }) => ({
    problem: message,
    ...(owner?.kind === "page" && { page: owner.path }),
  }));
}
