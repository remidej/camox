import { ARTIFACT_TOOL, type ArtifactDetails } from "@camox/api-contract/threads";
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ToolRegistration } from "@earendil-works/pi-durable";

import type { ToolInvocation } from "../threads/tools";

/** The artifact field an `artifact` call names, in a Locale, the Default Locale without one. */
export type ArtifactTarget = { block: string; item?: string; field: string; locale?: string };

/** What an `artifact` call hands the Artifact Agent, and whether its answer ends the turn. */
export type ArtifactCall = ArtifactTarget & { request: string; final: boolean };

/**
 * How an `artifact` call went: the Artifact Agent's answer, and whether it ends the turn, which
 * it only does when the model asked and nothing else of the turn needs the model again.
 */
export type ArtifactOutcome = { answer: string; final: boolean };

/**
 * The agent's `artifact` tool, which hands one artifact's source to its Artifact Agent and returns
 * its answer (ADR 0035). The model calls it itself, never from a script, so that the turn can end
 * on the Artifact Agent's answer. `run` finds or starts the Artifact Agent and waits for it, and
 * running it again for the same call waits for the same request, so a call an eviction cut short
 * runs again. `onActivity` hears what the Artifact Agent is doing as it works, for the studio.
 */
export const artifactTool = (
  run: (
    invocation: ToolInvocation,
    call: ArtifactCall,
    onActivity: (activity: NonNullable<ArtifactDetails["activity"]>) => Promise<void>,
  ) => Promise<ArtifactOutcome>,
): ToolRegistration =>
  defineTool({
    name: ARTIFACT_TOOL,
    description:
      "Hand an Artifact Source to its Artifact Agent, which writes and changes that one " +
      "artifact's source, its first version included, and remembers every earlier request about " +
      "it. Call it for every change to an Artifact Source rather than writing one yourself: " +
      "reads show you an artifact's title, never its source. The field must already be an " +
      "artifact field of a block or Repeatable Item placed in the draft. It returns the Artifact " +
      "Agent's answer.\n\n" +
      "`request` is what to change and why, for that agent alone: for a new artifact, what it's " +
      "for, what it shows and how it behaves, where it sits on the page and the facts it depends " +
      "on; after that, each change, in the editor's own words when the message is about the " +
      "artifact alone.\n\n" +
      "Set `final` when the Artifact Agent's answer is your answer to the editor: your turn then " +
      "ends on it, and the editor reads it as yours. When you changed the website's code in this " +
      "turn, or have more to do, the answer comes back to you instead, and you end your turn " +
      "yourself.",
    parameters: Type.Object({
      block: Type.String({
        description: "The ID of the block holding the artifact field, or holding its item.",
      }),
      item: Type.Optional(
        Type.String({ description: "The Repeatable Item's ID, when the field is an item's." }),
      ),
      field: Type.String({ description: "The artifact field's name." }),
      locale: Type.Optional(
        Type.String({ description: "The Locale's tag, such as `fr`. The Default Locale without." }),
      ),
      request: Type.String({ minLength: 1 }),
      final: Type.Boolean(),
    }),
    callers: ["model"],
    replay: "safe",
    async execute(args, api, context) {
      const outcome = await run({ api, context }, args, (activity) =>
        api.details({ activity } satisfies ArtifactDetails, context),
      );
      const details: ArtifactDetails = { answer: outcome.answer, final: outcome.final };
      return {
        output: [{ type: "text" as const, text: outcome.answer }],
        details,
        ...(outcome.final && { control: { terminate: true } }),
      };
    },
  });
