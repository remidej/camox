import { START_DRAFT_TOOL, type StartedDraftCard } from "@camox/api-contract/threads";
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ToolRegistration } from "@earendil-works/pi-durable";

import type { ToolInvocation } from "./tools";

/** What the agent on Live hands `startDraft`: the draft's name, and the Brief for its thread. */
export type DraftHandOff = { name: string; brief: string };

/**
 * The agent on Live's `startDraft`, which hands the request of the run going off to a draft it
 * starts (ADR 0025). The model calls it itself, never from a script, so that it ends the turn:
 * the Live turn ends on the draft's card, without another model request. `start` starts the
 * draft and its thread for the call, and repeating it changes nothing, so a call an eviction cut
 * short runs again.
 */
export const startDraftTool = (
  start: (invocation: ToolInvocation, handOff: DraftHandOff) => Promise<StartedDraftCard>,
): ToolRegistration =>
  defineTool({
    name: START_DRAFT_TOOL,
    description:
      "Hand the editor's request off to a new draft, where Camox's agent makes the changes: call " +
      "it for every request that would change the website, since you change nothing on Live. " +
      "`name` is the draft's name: a few words saying what it changes, in the editor's language. " +
      "`brief` opens the draft's thread, shown to everyone in the draft as from Camox, ahead of " +
      "the editor's messages of this turn, word for word: the context the request depends on " +
      "that those messages leave out, such as what earlier messages settled or what you found " +
      "reading the website, written for the agent doing the work. Never repeat the request in " +
      "it. Your turn ends with this call: the editor sees the draft's card, and nothing more.",
    parameters: Type.Object({
      name: Type.String({ minLength: 1, maxLength: 80 }),
      brief: Type.String({ minLength: 1 }),
    }),
    callers: ["model"],
    replay: "safe",
    async execute(args, api, context) {
      const card = await start({ api, context }, args);
      return {
        output: [{ type: "text" as const, text: JSON.stringify(card) }],
        details: card,
        control: { terminate: true },
      };
    },
  });
