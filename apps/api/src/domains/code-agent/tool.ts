import { CODE_TOOL } from "@camox/api-contract/threads";
import { Type } from "@earendil-works/pi-ai";
import type { ToolRegistration } from "@earendil-works/pi-durable";

import { handOffTool, type HandOffOutcome, type OnActivity } from "../threads/hand-off";
import type { ToolInvocation } from "../threads/tools";

/** What a `code` call hands the Code Agent, and whether its answer ends the turn. */
export type CodeCall = { request: string; final: boolean };

/**
 * The agent's `code` tool, which hands code work to the draft thread's Code Agent and returns its
 * answer, once its changes built or it explained what's left (`handOffTool`).
 */
export const codeTool = (
  run: (
    invocation: ToolInvocation,
    call: CodeCall,
    onActivity: OnActivity,
  ) => Promise<HandOffOutcome>,
): ToolRegistration =>
  handOffTool(
    {
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
    },
    run,
  );
