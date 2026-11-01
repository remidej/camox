import { generateUuidv7 } from "@camox/api-contract/ids";
import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import type { OpeningSender } from "../../durable-objects/thread";
import { runService } from "../../lib/run-service";
import { DRAFT_NAME_MAX_LENGTH, DRAFT_NAME_RULES } from "../drafts/name";
import { startDraft } from "../drafts/service";
import { draftThread } from "../threads/service";
import { clientNamed, connectedAgentClientOf } from "./agents";
import { draftArgument, openDraft } from "./draft-ref";
import { MESSAGE_DESCRIPTION } from "./guidance";
import { DRAFTS_SCOPE } from "./oauth";
import { registerProjectTool } from "./projects";
import type { ConnectedAgentCall } from "./routes";
import { memberServiceContext, requireScope, serviceRefusal, toolRefusal } from "./tools";
import { answerWithTurn } from "./turn";

/** The member's Connected Agent, as its messages record it as their sender. */
async function connectedAgentOf(call: ConnectedAgentCall): Promise<OpeningSender> {
  const { user } = call.member;
  // A client deleted since its token was issued is an unnamed app.
  const client =
    (await connectedAgentClientOf(call.db, call.clientId)) ?? clientNamed(undefined, undefined);
  return {
    kind: "connectedAgent",
    member: { id: user.id, name: user.name, image: user.image ?? null },
    client,
  };
}

/**
 * The tools that start and continue drafts.
 *
 * `start_draft`: starts a draft created by the member, whose thread opens with the Connected
 * Agent's message, with no Brief, and runs a turn of Camox's agent in it, as an editor's first
 * message would (ADR 0030). Answers once the turn ends.
 *
 * `send_message`: sends a message into an open draft's thread, named by its id or a studio link,
 * whoever started it. It starts a turn, or steers the one going, as an editor's message does,
 * and answers once that turn ends.
 */
export function registerDraftTools(server: McpServer, call: ConnectedAgentCall) {
  registerProjectTool(
    server,
    call,
    "start_draft",
    {
      title: "Start a draft",
      description:
        "Starts a new draft of the website, where Camox's agent makes the change you ask for, and waits for its answer. Nothing reaches the live website until the member publishes the draft in the studio. Each new request gets its own draft.",
      inputSchema: {
        name: z
          .string()
          .trim()
          .min(1)
          .max(DRAFT_NAME_MAX_LENGTH)
          .describe(
            `The draft's name, saying what it changes. ${DRAFT_NAME_RULES} Camox renames the draft once the name no longer fits it.`,
          ),
        message: z.string().trim().min(1).describe(MESSAGE_DESCRIPTION),
      },
      scope: DRAFTS_SCOPE,
    },
    async ({ project }, { name, message }) => {
      const { user } = call.member;
      const from = await connectedAgentOf(call);
      const draftId = generateUuidv7();
      const threadId = generateUuidv7();
      const operationId = generateUuidv7();
      await runService(
        startDraft(call.db, {
          id: draftId,
          projectId: project.id,
          createdBy: user.id,
          name,
          threadId,
          openingRequest: message,
        }),
      );
      await call.env.THREAD.getByName(threadId).open({
        identity: { projectId: project.id, draftId, ownerId: null },
        apiOrigin: call.apiOrigin,
        messages: [
          {
            operationId,
            text: message,
            from,
          },
        ],
      });
      return answerWithTurn(call, { project, draftId, threadId, operationId });
    },
  );

  server.registerTool(
    "send_message",
    {
      title: "Send a message to a draft",
      description:
        "Sends a message to Camox's agent in a draft, to refine or follow up on its work, and waits for its answer. Any open draft works, including drafts teammates started in the studio. A message sent while the agent works on the draft is taken into what it's doing.",
      inputSchema: z.object({
        draft: draftArgument,
        message: z.string().trim().min(1).describe(MESSAGE_DESCRIPTION),
      }),
      annotations: { readOnlyHint: false, openWorldHint: false },
      scopeChallenge: requireScope(DRAFTS_SCOPE),
    },
    async ({ draft: ref, message }) => {
      const reached = await openDraft(call, ref);
      if ("refusal" in reached) return toolRefusal(reached.refusal);
      const { id: draftId, project } = reached.draft;
      const operationId = generateUuidv7();
      try {
        const { threadId } = await runService(
          draftThread(memberServiceContext(call, draftId), project.id),
        );
        await call.env.THREAD.getByName(threadId).send({
          identity: { projectId: project.id, draftId, ownerId: null },
          apiOrigin: call.apiOrigin,
          message: { operationId, text: message, from: await connectedAgentOf(call) },
        });
        return answerWithTurn(call, { project, draftId, threadId, operationId });
      } catch (error) {
        return refusalOfEndedDraft(call, ref, error);
      }
    },
  );
}

/**
 * The refusal for a draft that ended while a Connected Agent's message was on its way to it,
 * saying how, or the service's refusal. Anything else is thrown again.
 */
async function refusalOfEndedDraft(
  call: ConnectedAgentCall,
  ref: string,
  error: unknown,
): Promise<CallToolResult> {
  const reached = await openDraft(call, ref);
  if ("refusal" in reached) return toolRefusal(reached.refusal);
  return serviceRefusal(error);
}
