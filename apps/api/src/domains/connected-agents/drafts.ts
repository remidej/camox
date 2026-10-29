import { generateUuidv7 } from "@camox/api-contract/ids";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { runService } from "../../lib/run-service";
import { startDraft } from "../drafts/service";
import { connectedAgentClientOf } from "./consent";
import { MESSAGE_DESCRIPTION } from "./guidance";
import { registerProjectTool } from "./projects";
import type { ConnectedAgentCall } from "./routes";
import { answerWithTurn } from "./turn";

/** What a Connected Agent's message records of its client when the client is gone. */
const UNKNOWN_CLIENT = { name: "An unnamed app", verified: false };

/**
 * `start_draft`: starts a draft created by the member, whose thread opens with the Connected
 * Agent's message, with no Brief, and runs a turn of Camox's agent in it, as an editor's first
 * message would (ADR 0030). Answers once the turn ends.
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
        name: z.string().trim().min(1).max(200).describe("A few words saying what it changes."),
        message: z.string().trim().min(1).describe(MESSAGE_DESCRIPTION),
      },
    },
    async ({ project }, { name, message }) => {
      const { user } = call.member;
      const client = (await connectedAgentClientOf(call.db, call.clientId)) ?? UNKNOWN_CLIENT;
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
        }),
      );
      await call.env.THREAD.getByName(threadId).open({
        identity: { projectId: project.id, draftId, ownerId: null },
        apiOrigin: call.apiOrigin,
        messages: [
          {
            operationId,
            text: message,
            from: {
              kind: "connectedAgent",
              member: { id: user.id, name: user.name, image: user.image ?? null },
              client,
            },
          },
        ],
      });
      return answerWithTurn(call, { project, draftId, threadId, operationId });
    },
  );
}
