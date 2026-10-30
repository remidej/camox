import type { NotPublishedReason } from "@camox/api-contract/drafts";
import { Effect } from "effect";
import { z } from "zod";

import {
  deleteDraft,
  previewPublish as studioPreview,
  type Problem,
  publishDraft,
  type PublishPreview,
} from "../../../../apps/api/src/domains/drafts/publish";
import { runService } from "../../../../apps/api/src/lib/run-service";
import { endedDraftSchema, publishPreviewSchema } from "../lib/outputs";
import { defineTool, type ToolDefinition, type ToolProvider } from "../types";

// Publishing and deleting the session's draft (ADR 0009). The draft always comes from the
// request context, never from a parameter, so other surfaces can reuse these tools for other
// drafts (ADR 0010).

const previewInput = z.object({});
const publishToolInput = z.object({
  token: z.string().min(1).describe("The token previewPublish returned with the list it showed."),
  revision: z
    .string()
    .optional()
    .describe(
      "For a draft whose code the agent changed: the `code.revision` previewPublish returned, " +
        "the build publishing ships.",
    ),
});
const deleteInput = z.object({});

/** A blocker or warning as agents see it: without where the studio shows it in the Canvas. */
const withoutCanvasPlace = ({ fieldKind: _fieldKind, blockId: _blockId, ...problem }: Problem) =>
  problem;

/**
 * The preview as agents see it: without which conflicts the studio offers to use Live's version
 * of, which agents can't do, nor the fields the studio's conflict cards show, nor where the
 * studio shows a problem or a finding, nor the studio's Draft Overview.
 */
const withoutStudioActions = ({ overview: _overview, ...preview }: PublishPreview) => ({
  ...preview,
  findings: preview.findings.map(
    ({
      place: _place,
      fieldKind: _fieldKind,
      raisedAt: _raisedAt,
      live: _live,
      patroller: _patroller,
      ...finding
    }) => finding,
  ),
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
    reason: z.literal("deleted"),
    message: z.string(),
    ended: endedDraftSchema,
  }),
  z.strictObject({
    published: z.literal(false),
    reason: z.enum([
      "conflictsChanged",
      "blocked",
      "translating",
      "findings",
      "checking",
      "revisionChanged",
    ]),
    message: z.string(),
    preview: publishPreviewSchema,
  }),
]);

const PREVIEW_SHAPE =
  "`blockers` are problems to fix in the draft before it can be published, including " +
  "code the agent changed that doesn't build (code " +
  "`codeDoesNotBuild`), doesn't type check (code `codeDoesNotTypeCheck`) or doesn't merge with " +
  "Live's latest code, which Camox's agent fixes in the draft's thread (code `codeDoesNotMerge`); " +
  "`conflicts` is content Live changed or deleted since the draft " +
  "changed it, each with who published Live's version and when, which publishing overwrites; " +
  "`lost` lists changes publishing will drop because their parent is gone; `warnings` are the " +
  "same problems already on Live, which don't block; `changes` lists everything the draft " +
  "creates, changes or deletes; `translating` lists the locales Camox is still translating the " +
  "draft into, which publishing waits for; `findings` are the draft's open findings, problems " +
  "Camox's patrollers raised in what it changed (a link to a page that no longer exists, a link " +
  "that doesn't work), each with the content it's in and the fix it suggests if " +
  "any, which publishing waits for until each is fixed or a member dismisses it; `checking` " +
  "names the patrollers still checking the draft's latest changes, which publishing waits for; " +
  "`defaultLocale` is the tag of the default locale, " +
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
      "`{ blockers, conflicts, lost, warnings, changes, translating, findings, checking, " +
      "defaultLocale, token, code }`. " +
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
      "the ones that preview showed. Returns `{ published: true, ended }` once published. " +
      "For a draft whose " +
      "code the agent changed, also pass previewPublish's `code.revision`: publishing then runs " +
      "in the background and returns `{ published: true, ended: null }` as it starts; when the " +
      "code changed since the preview it returns `reason: 'revisionChanged'`. When Live changed " +
      "since the preview, or the draft has blockers, nothing is published and it returns " +
      "`{ published: false, reason: 'conflictsChanged' | 'blocked', message, preview }` with a " +
      "fresh preview and token: show the new list and ask again before retrying. While " +
      "translations are still running, nothing is published and it returns " +
      "`{ published: false, reason: 'translating', message, preview }`: publishing waits for " +
      "every translation, with no way around it, so tell the user which locales it waits for " +
      "rather than retry at once. While the draft has open findings, or its patrollers are " +
      "still checking it, nothing is published and it returns " +
      "`{ published: false, reason: 'findings' | 'checking', message, preview }`: publishing " +
      "waits for every finding to be fixed or dismissed by a member, and for every check, with " +
      "no way around it, so fix what you can and tell the user what needs them. When the draft " +
      "has no changes, nothing is published and it returns " +
      "`{ published: false, reason: 'empty', message }`. When the draft was already deleted, " +
      "nothing is published and it returns `{ published: false, reason: 'deleted', message, " +
      "ended }`.",
    inputSchema: publishToolInput,
    outputSchema: publishResultSchema,
    meta: { kind: "write", surfaces: ["cli"] },
    handler: async (input) => {
      const { token, revision } = publishToolInput.parse(input);
      const notPublished = (reason: NotPublishedReason, message: string) =>
        previewPublish(ctx, { projectId: ctx.projectId }).pipe(
          Effect.map((preview) => ({ published: false as const, reason, message, preview })),
        );
      return runService(
        publishDraft(ctx, { projectId: ctx.projectId, token, revision }).pipe(
          Effect.map(({ empty, ended }) => {
            if (empty)
              return { published: false as const, reason: "empty" as const, message: EMPTY };
            if (ended?.outcome === "deleted") {
              const message = `${ended.endedBy.name} deleted the draft.`;
              return { published: false as const, reason: "deleted" as const, message, ended };
            }
            return { published: true as const, ended };
          }),
          Effect.catchTags({
            ConflictsChangedError: (error) => notPublished("conflictsChanged", error.message),
            PublishBlockedError: (error) => notPublished("blocked", error.message),
            TranslationsPendingError: (error) => notPublished("translating", error.message),
            FindingsOpenError: (error) => notPublished("findings", error.message),
            ChecksRunningError: (error) => notPublished("checking", error.message),
            RevisionChangedError: (error) => notPublished("revisionChanged", error.message),
          }),
        ),
      );
    },
  }),
  defineTool({
    name: "deleteDraft",
    description:
      "Delete every change in the current draft without publishing it, ending the draft. Live " +
      "is untouched. This can't be undone, so only delete when the user asks to. Returns " +
      "`{ ended }`.",
    inputSchema: deleteInput,
    outputSchema: z.strictObject({ ended: endedDraftSchema.nullable() }),
    meta: { kind: "write", surfaces: ["cli"] },
    handler: async () => runService(deleteDraft(ctx, { projectId: ctx.projectId })),
  }),
];
