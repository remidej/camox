import type { HandOffDetails } from "@camox/api-contract/threads";
import type { Static, TSchema } from "@earendil-works/pi-ai";
import { defineTool, type ToolRegistration } from "@earendil-works/pi-durable";

import type { ToolInvocation } from "./tools";

/**
 * How a hand-off went: the answer of the agent it handed work to, and whether it ends the turn,
 * which it only does when the model asked and nothing else of the turn needs the model again.
 */
export type HandOffOutcome = { answer: string; final: boolean };

/** What the agent handed work to is doing as it works, for the studio. */
export type OnActivity = (activity: NonNullable<HandOffDetails["activity"]>) => Promise<void>;

/**
 * A tool of the thread's agent that hands work to another part of Camox's agent, such as the Code
 * Agent, and returns its answer, ending the turn on it when `run` says so. The model calls it
 * itself, never from a script, so that the turn can end on that answer. `run` finds or starts the
 * agent and waits for it, and running it again for the same call waits for the same request, so a
 * call an eviction cut short runs again. `onActivity` hears what the agent is doing as it works.
 */
export const handOffTool = <Parameters extends TSchema>(
  tool: { name: string; description: string; parameters: Parameters },
  run: (
    invocation: ToolInvocation,
    call: Static<Parameters>,
    onActivity: OnActivity,
  ) => Promise<HandOffOutcome>,
): ToolRegistration =>
  defineTool({
    ...tool,
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
