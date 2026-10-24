import type { NotPublishedReason } from "@camox/api-contract/drafts";
import { Effect } from "effect";
import { z } from "zod";

import {
  discardDraft,
  previewPublish as studioPreview,
  type Problem,
  publishDraft,
  type PublishPreview,
} from "../../../../apps/api/src/domains/drafts/publish";
import { runService } from "../../../../apps/api/src/lib/run-service";
import { endedDraftSchema, publishPreviewSchema } from "../lib/outputs";
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
  revision: z
    .string()
    .optional()
    .describe(
      "For a draft whose code the agent changed: the `code.revision` previewPublish returned, " +
        "the build publishing ships.",
    ),
});
const discardInput = z.object({});

/** A blocker or warning as agents see it: without where the studio shows it in the Canvas. */
const withoutCanvasPlace = ({ fieldKind: _fieldKind, blockId: _blockId, ...problem }: Problem) =>
  problem;

/**
 * The preview as agents see it: without which conflicts the studio offers to use Live's version
 * of, which agents can't do, nor the fields the studio's conflict cards show, nor where the
 * studio shows a problem, nor the studio's Draft Overview.
 */
const withoutStudioActions = ({ overview: _overview, ...preview }: PublishPreview) => ({
  ...preview,
  blockers: preview.blockers.map(withoutCanvasPlace),
  warnings: preview.warnings.map(withoutCanvasPlace),
  conflicts: preview.conflicts.map(
    ({ revertible: _revertible, fields: _fields, moreFields: _moreFields, ...conflict }) =>
      conflict,
  ),
});

const previewPublish = (...args: Parameters<typeof studioPreview>) =>
  studioPreview(...args).pipe(Effect.map(withoutStudioActions));

const publishResultSchema = z.union([
  z.strictObject({ published: z.literal(true), ended: endedDraftSchema.nullable() }),
  z.strictObject({ published: z.literal(false), reason: z.literal("empty"), message: z.string() }),
  z.strictObject({
    published: z.literal(false),
    reason: z.literal("discarded"),
    message: z.string(),
    ended: endedDraftSchema,
  }),
  z.strictObject({
    published: z.literal(false),
    reason: z.enum(["conflictsChanged", "blocked", "translating", "revisionChanged"]),
    message: z.string(),
    preview: publishPreviewSchema,
  }),
]);

const PREVIEW_SHAPE =
  "`blockers` are problems to fix in the draft before it can be published, including " +
  "definitions that differ from Live's in a development draft, which only a release can ship " +
  "(code `definitionsDiffer`), and code the agent changed that doesn't build (code " +
  "`codeDoesNotBuild`), doesn't type check (code `codeDoesNotTypeCheck`) or doesn't merge with " +
  "Live's latest code, which Camox's agent fixes in the draft's thread (code `codeDoesNotMerge`); " +
  "`conflicts` is content Live changed or deleted since the draft " +
  "changed it, each with who published Live's version and when, which publishing overwrites; " +
  "`lost` lists changes publishing will drop because their parent is gone; `warnings` are the " +
  "same problems already on Live, which don't block; `changes` lists everything the draft " +
  "creates, changes or deletes; `translating` lists the locales Camox is still translating the " +
  "draft into, which publishing waits for; `defaultLocale` is the tag of the default locale, " +
  "which the others are translated from. `token` records the conflicts shown. `code` is null " +
  "unless the agent changed the draft's code: then `revision` is the last revision that built, " +
  "which the preview shows, `includesLive` whether the code holds Live's latest, and `building` " +
  "whether the latest changes are still building, which publishing should wait for, " +
  "`publishing` whether a publish of the draft runs, and `publishAborted` why its last one " +
  "stopped before landing, if it did.";

const EMPTY = "The draft has no changes, so there is nothing to publish.";

export const draftsProvider: ToolProvider = (ctx): ToolDefinition[] => [
  defineTool({
    name: "previewPublish",
    description:
      "List what publishing the current draft to Live would do, without publishing. Returns " +
      "`{ blockers, conflicts, lost, warnings, changes, translating, defaultLocale, token, code }`. " +
      PREVIEW_SHAPE +
      " Show this list to the user. `token` is the one publishDraft takes to publish exactly " +
      "what this preview showed.",
    inputSchema: previewInput,
    outputSchema: publishPreviewSchema,
    meta: { kind: "read", surfaces: ["cli", "studio-agent"] },
    handler: async () => runService(previewPublish(ctx, { projectId: ctx.projectId })),
  }),
  defineTool({
    name: "publishDraft",
    description:
      "Publish the whole current draft to Live, replacing Live's version of everything it " +
      "changed. Only publish when the user asks to. Pass the token from previewPublish: " +
      "publishing goes ahead only while the draft has no blockers and Live's conflicts are still " +
      "the ones that preview showed. Returns `{ published: true, ended }` once published " +
      "(a development draft stays open, emptied, so `ended` is null for it). For a draft whose " +
      "code the agent changed, also pass previewPublish's `code.revision`: publishing then runs " +
      "in the background and returns `{ published: true, ended: null }` as it starts; when the " +
      "code changed since the preview it returns `reason: 'revisionChanged'`. When Live changed " +
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
    outputSchema: publishResultSchema,
    meta: { kind: "write", surfaces: ["cli"] },
    handler: async (input) => {
      const { token, publishAnyway, revision } = publishToolInput.parse(input);
      const notPublished = (reason: NotPublishedReason, message: string) =>
        previewPublish(ctx, { projectId: ctx.projectId }).pipe(
          Effect.map((preview) => ({ published: false as const, reason, message, preview })),
        );
      return runService(
        publishDraft(ctx, { projectId: ctx.projectId, token, publishAnyway, revision }).pipe(
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
            RevisionChangedError: (error) => notPublished("revisionChanged", error.message),
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
    outputSchema: z.strictObject({ ended: endedDraftSchema.nullable() }),
    meta: { kind: "write", surfaces: ["cli"] },
    handler: async () => runService(discardDraft(ctx, { projectId: ctx.projectId })),
  }),
];
