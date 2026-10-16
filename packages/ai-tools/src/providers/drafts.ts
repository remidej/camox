import { Effect } from "effect";
import { z } from "zod";

import {
  discardDraft,
  previewPublish,
  publishDraft,
} from "../../../../apps/api/src/domains/drafts/publish";
import { runService } from "../../../../apps/api/src/lib/run-service";
import type { ToolDefinition, ToolProvider } from "../types";

// Publishing and discarding the session's draft (ADR 0009). The draft always comes from the
// request context, never from a parameter, so other surfaces can reuse these tools for other
// drafts (ADR 0010).

const previewInput = z.object({});
const publishToolInput = z.object({
  token: z.string().min(1).describe("The token previewPublish returned with the list it showed."),
});
const discardInput = z.object({});

const PREVIEW_SHAPE =
  "`blockers` are problems to fix in the draft before it can be published, including " +
  "definitions that differ from Live's in a development draft, which only a release can ship " +
  "(code `definitionsDiffer`); `conflicts` is content Live changed or deleted since the draft " +
  "changed it, each with who published Live's version and when, which publishing overwrites; " +
  "`lost` lists changes publishing will drop because their parent is gone; `warnings` are the " +
  "same problems already on Live, which don't block; `changes` lists everything the draft " +
  "creates, changes or deletes. `token` records the conflicts shown.";

const EMPTY = "The draft has no changes, so there is nothing to publish.";

export const draftsProvider: ToolProvider = (ctx): ToolDefinition[] => [
  {
    name: "previewPublish",
    description:
      "List what publishing the current draft to Live would do, without publishing. Returns " +
      "`{ blockers, conflicts, lost, warnings, changes, token }`. " +
      PREVIEW_SHAPE +
      " Show this list to the user, then pass the token to publishDraft once they confirm.",
    inputSchema: previewInput,
    meta: { kind: "read", risk: "safe", surfaces: ["cli"] },
    handler: async () => runService(previewPublish(ctx, { projectId: ctx.projectId })),
  },
  {
    name: "publishDraft",
    description:
      "Publish the whole current draft to Live, replacing Live's version of everything it " +
      "changed. Only publish when the user asks to. Pass the token from previewPublish: " +
      "publishing goes ahead only while the draft has no blockers and Live's conflicts are still " +
      "the ones that preview showed. Returns `{ published: true, ended }` once published " +
      "(a development draft stays open, emptied, so `ended` is null for it). When Live changed " +
      "since the preview, or the draft has blockers, nothing is published and it returns " +
      "`{ published: false, reason: 'conflictsChanged' | 'blocked', message, preview }` with a " +
      "fresh preview and token: show the new list and ask again before retrying. When the draft " +
      "has no changes, nothing is published and it returns " +
      "`{ published: false, reason: 'empty', message }`.",
    inputSchema: publishToolInput,
    meta: { kind: "write", risk: "requiresApproval", surfaces: ["cli"] },
    handler: async (input) => {
      const { token } = publishToolInput.parse(input);
      const notPublished = (reason: "conflictsChanged" | "blocked", message: string) =>
        previewPublish(ctx, { projectId: ctx.projectId }).pipe(
          Effect.map((preview) => ({ published: false as const, reason, message, preview })),
        );
      return runService(
        publishDraft(ctx, { projectId: ctx.projectId, token }).pipe(
          Effect.map(({ empty, ended }) => {
            if (empty)
              return { published: false as const, reason: "empty" as const, message: EMPTY };
            return { published: true as const, ended };
          }),
          Effect.catchTags({
            ConflictsChangedError: (error) => notPublished("conflictsChanged", error.message),
            PublishBlockedError: (error) => notPublished("blocked", error.message),
          }),
        ),
      );
    },
  },
  {
    name: "discardDraft",
    description:
      "Discard every change in the current draft without publishing it. A development draft " +
      "stays open, emptied; any other draft ends. Live is untouched. This can't be undone, so " +
      "only discard when the user asks to. Returns `{ ended }`, null for a development draft.",
    inputSchema: discardInput,
    meta: { kind: "write", risk: "requiresApproval", surfaces: ["cli"] },
    handler: async () => runService(discardDraft(ctx, { projectId: ctx.projectId })),
  },
];
