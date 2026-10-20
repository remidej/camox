import type { NotPublishedReason } from "@camox/api-contract/drafts";
import { Effect } from "effect";
import { z } from "zod";

import {
  discardDraft,
  previewPublish,
  publishDraft,
} from "../../../../apps/api/src/domains/drafts/publish";
import { runService } from "../../../../apps/api/src/lib/run-service";
import { endedDraft, publishPreview } from "../lib/outputs";
import { defineTool, type ToolDefinition, type ToolProvider } from "../types";

// Publishing and discarding the session's draft (ADR 0009). The draft always comes from the
// request context, never from a parameter, so other surfaces can reuse these tools for other
// drafts (ADR 0010).

const previewInput = z.object({});
const publishToolInput = z.object({
  token: z.string().min(1).describe("The token previewPublish returned with the list it showed."),
  publishAnyway: z
    .boolean()
    .optional()
    .describe(
      "Publish while translations are still running, only when the user asks to: Camox " +
        "finishes them in a draft of its own and publishes it once they're done.",
    ),
});
const discardInput = z.object({});

const publishOutput = z.union([
  z.object({ published: z.literal(true), ended: endedDraft.nullable() }),
  z.object({ published: z.literal(false), reason: z.literal("empty"), message: z.string() }),
  z.object({
    published: z.literal(false),
    reason: z.literal("discarded"),
    message: z.string(),
    ended: endedDraft,
  }),
  z.object({
    published: z.literal(false),
    reason: z.enum(["conflictsChanged", "blocked", "translating"]),
    message: z.string(),
    preview: publishPreview,
  }),
]);

const PREVIEW_SHAPE =
  "`blockers` are problems to fix in the draft before it can be published, including " +
  "definitions that differ from Live's in a development draft, which only a release can ship " +
  "(code `definitionsDiffer`); `conflicts` is content Live changed or deleted since the draft " +
  "changed it, each with who published Live's version and when, which publishing overwrites; " +
  "`lost` lists changes publishing will drop because their parent is gone; `warnings` are the " +
  "same problems already on Live, which don't block; `changes` lists everything the draft " +
  "creates, changes or deletes; `translating` lists the locales Camox is still translating the " +
  "draft into, which publishing waits for; `defaultLocale` is the tag of the default locale, " +
  "which the others are translated from. `token` records the conflicts shown.";

const EMPTY = "The draft has no changes, so there is nothing to publish.";

export const draftsProvider: ToolProvider = (ctx): ToolDefinition[] => [
  defineTool({
    name: "previewPublish",
    description:
      "List what publishing the current draft to Live would do, without publishing. Returns " +
      "`{ blockers, conflicts, lost, warnings, changes, translating, defaultLocale, token }`. " +
      PREVIEW_SHAPE +
      " Show this list to the user, then pass the token to publishDraft once they confirm.",
    inputSchema: previewInput,
    outputSchema: publishPreview,
    meta: { kind: "read", risk: "safe", surfaces: ["cli"] },
    handler: async () => runService(previewPublish(ctx, { projectId: ctx.projectId })),
  }),
  defineTool({
    name: "publishDraft",
    description:
      "Publish the whole current draft to Live, replacing Live's version of everything it " +
      "changed. Only publish when the user asks to. Pass the token from previewPublish: " +
      "publishing goes ahead only while the draft has no blockers and Live's conflicts are still " +
      "the ones that preview showed. Returns `{ published: true, ended }` once published " +
      "(a development draft stays open, emptied, so `ended` is null for it). When Live changed " +
      "since the preview, or the draft has blockers, nothing is published and it returns " +
      "`{ published: false, reason: 'conflictsChanged' | 'blocked', message, preview }` with a " +
      "fresh preview and token: show the new list and ask again before retrying. While " +
      "translations are still running, nothing is published and it returns " +
      "`{ published: false, reason: 'translating', message, preview }`: wait and retry, or pass " +
      "`publishAnyway: true` if the user wants to publish now, and Camox finishes the " +
      "translations in a draft of its own that it publishes once they're done. When the draft " +
      "has no changes, nothing is published and it returns " +
      "`{ published: false, reason: 'empty', message }`. When the draft was already discarded, " +
      "nothing is published and it returns `{ published: false, reason: 'discarded', message, " +
      "ended }`.",
    inputSchema: publishToolInput,
    outputSchema: publishOutput,
    meta: { kind: "write", risk: "requiresApproval", surfaces: ["cli"] },
    handler: async (input) => {
      const { token, publishAnyway } = publishToolInput.parse(input);
      const notPublished = (reason: NotPublishedReason, message: string) =>
        previewPublish(ctx, { projectId: ctx.projectId }).pipe(
          Effect.map((preview) => ({ published: false as const, reason, message, preview })),
        );
      return runService(
        publishDraft(ctx, { projectId: ctx.projectId, token, publishAnyway }).pipe(
          Effect.map(({ empty, ended }) => {
            if (empty)
              return { published: false as const, reason: "empty" as const, message: EMPTY };
            if (ended?.outcome === "discarded") {
              const message = `${ended.endedBy.name} discarded the draft.`;
              return { published: false as const, reason: "discarded" as const, message, ended };
            }
            return { published: true as const, ended };
          }),
          Effect.catchTags({
            ConflictsChangedError: (error) => notPublished("conflictsChanged", error.message),
            PublishBlockedError: (error) => notPublished("blocked", error.message),
            TranslationsPendingError: (error) => notPublished("translating", error.message),
          }),
        ),
      );
    },
  }),
  defineTool({
    name: "discardDraft",
    description:
      "Discard every change in the current draft without publishing it. A development draft " +
      "stays open, emptied; any other draft ends. Live is untouched. This can't be undone, so " +
      "only discard when the user asks to. Returns `{ ended }`, null for a development draft.",
    inputSchema: discardInput,
    outputSchema: z.object({ ended: endedDraft.nullable() }),
    meta: { kind: "write", risk: "requiresApproval", surfaces: ["cli"] },
    handler: async () => runService(discardDraft(ctx, { projectId: ctx.projectId })),
  }),
];
