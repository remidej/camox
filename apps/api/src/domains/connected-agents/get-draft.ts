import type { ThreadMessage } from "@camox/api-contract/threads";
import type { McpServer } from "@modelcontextprotocol/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { drafts } from "../drafts/schema";
import { draftArgument, seeDraft } from "./draft-ref";
import { memberServiceContext, toolAnswer, toolRefusal } from "./projects";
import type { ConnectedAgentCall } from "./routes";
import { blockersOf } from "./turn";

/**
 * A thread's message as a Connected Agent reads it: who said what, with no tool steps. Pushes
 * aren't messages anyone wrote.
 */
function messageOf(message: ThreadMessage) {
  switch (message.from) {
    case "editor":
      return { from: "editor", name: message.sender.name, text: message.text };
    case "connectedAgent":
      return {
        from: "connectedAgent",
        member: message.member.name,
        client: message.client.name,
        text: message.text,
      };
    case "camox":
    case "agent":
      return { from: message.from, text: message.text };
    case "failed":
      return { from: "failed" };
    case "stopped":
      return { from: "stopped", stoppedBy: message.sender.name };
    case "draft":
    case "push":
      return [];
  }
}

/**
 * `get_draft`: how a draft stands, for a Connected Agent to follow up on it (ADR 0030): its name
 * and state, and for an open one, whether the agent is working, its Blockers, and its thread's
 * messages from editors, Connected Agents and the agent. An ended draft's thread is gone with it.
 */
export function registerGetDraft(server: McpServer, call: ConnectedAgentCall) {
  server.registerTool(
    "get_draft",
    {
      title: "Get a draft",
      description:
        "Reads how a draft stands: its name, whether it's open, published or deleted, whether Camox's agent is working on it, what blocks publishing it, and the messages its thread holds, including feedback teammates left in the studio. Use it to follow up after Camox's agent said it was still working.",
      inputSchema: z.object({ draft: draftArgument }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ draft: ref }) => {
      const seen = await seeDraft(call, ref);
      if ("refusal" in seen) return toolRefusal(seen.refusal);
      const { draft, ended } = seen;
      if (ended) {
        return toolAnswer({
          draft: draft.id,
          name: draft.name,
          state: ended.outcome,
          endedBy: ended.endedBy,
          endedAt: new Date(ended.endedAt).toISOString(),
        });
      }
      const row = await call.db
        .select({ threadId: drafts.threadId })
        .from(drafts)
        .where(eq(drafts.id, draft.id))
        .get();
      const ctx = { ...memberServiceContext(call), draft: { id: draft.id, create: false } };
      const [view, blockers] = await Promise.all([
        row?.threadId ? call.env.THREAD.getByName(row.threadId).view() : undefined,
        blockersOf(ctx, draft.project.project.id),
      ]);
      return toolAnswer({
        draft: draft.id,
        name: draft.name,
        state: "open",
        turnRunning: view?.running ?? false,
        blockers,
        messages: view?.messages.flatMap(messageOf) ?? [],
      });
    },
  );
}
