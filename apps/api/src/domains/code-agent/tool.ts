import { CODE_TOOL, type HandOffDetails } from "@camox/api-contract/threads";
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ToolRegistration } from "@earendil-works/pi-durable";

import type { ToolInvocation } from "../threads/tools";

/** What a `code` call hands the Code Agent, and whether its answer ends the turn. */
export type CodeCall = { request: string; final: boolean };

/**
 * How a `code` call went: the Code Agent's answer, and whether it ends the turn, which it only
 * does when the model asked and nothing else of the turn needs the model again.
 */
export type CodeOutcome = { answer: string; final: boolean };

/**
 * The agent's `code` tool, which hands code work to the draft thread's Code Agent and returns its
 * answer, once its changes built or it explained what's left. The model calls it itself, never
 * from a script, so that the turn can end on the Code Agent's answer. `run` finds or starts the
 * Code Agent and waits for it, and running it again for the same call waits for the same request,
 * so a call an eviction cut short runs again. `onActivity` hears what the Code Agent is doing as
 * it works, for the studio.
 */
export const codeTool = (
  run: (
    invocation: ToolInvocation,
    call: CodeCall,
    onActivity: (activity: NonNullable<HandOffDetails["activity"]>) => Promise<void>,
  ) => Promise<CodeOutcome>,
): ToolRegistration =>
  defineTool({
    name: CODE_TOOL,
    description:
      "Hand code work to the Code Agent, which reads and writes the website's code and " +
      "remembers every earlier request of this thread: a new Block Definition, a field or Block " +
      "Setting, a Layout, a Theme change, a redesign. It never sees pages or their content. It " +
      "returns the Code Agent's answer once its changes built, naming the Block Definitions, " +
      "fields, Block Settings and Layouts it added or changed, which you can then place and " +
      "fill.\n\n" +
      "`request` is what the code must do and why: the block's purpose and the shape of its " +
      "content, such as how many items and how long their text may be, never the content itself " +
      "or the page it's for.\n\n" +
      "Set `final` when the Code Agent's answer is your answer to the editor: your turn then " +
      "ends on it, and the editor reads it as yours. When you have more to do, the answer comes " +
      "back to you instead, and you end your turn yourself.",
    parameters: Type.Object({
      request: Type.String({ minLength: 1 }),
      final: Type.Boolean(),
    }),
    callers: ["model"],
    replay: "safe",
    async execute(args, api, context) {
      const outcome = await run({ api, context }, args, (activity) =>
        api.details({ activity } satisfies HandOffDetails, context),
      );
      const details: HandOffDetails = { answer: outcome.answer, final: outcome.final };
      return {
        output: [{ type: "text" as const, text: outcome.answer }],
        details,
        ...(outcome.final && { control: { terminate: true } }),
      };
    },
  });
