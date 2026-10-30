import { type FindingAbout, type FindingFix, PATROLLER_IDS } from "@camox/api-contract/patrol";
import { Effect } from "effect";
import { z } from "zod";

import { applyFix } from "../../../../apps/api/src/domains/patrol/fixes";
import { listFindings as openFindings } from "../../../../apps/api/src/domains/patrol/read";
import { runService } from "../../../../apps/api/src/lib/run-service";
import { defineTool, type ToolDefinition, type ToolProvider } from "../types";

// The findings patrollers raise in the current draft (ADR 0034): reading them, and applying the
// fix one suggests, as a member would. Only members dismiss findings: no tool does.

const aboutSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("missingPage"),
    url: z.string(),
    text: z.string(),
    page: z.string().nullable(),
  }),
  z.strictObject({
    kind: z.literal("brokenLink"),
    url: z.string(),
    text: z.string(),
    failure: z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("status"), status: z.number() }),
      z.strictObject({ kind: z.literal("unreachable") }),
      z.strictObject({ kind: z.literal("timeout") }),
    ]),
  }),
  z.strictObject({
    kind: z.enum(["misspelling", "grammar"]),
    text: z.string(),
    sentence: z.string(),
  }),
]);
const fixSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("removeLink") }),
  z.strictObject({ kind: z.literal("replaceText"), replacement: z.string() }),
]);

/** Whether two types are the same, each assignable to the other. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
// The schemas match the contract: a finding kind or fix it adds or changes fails the type check.
true satisfies Same<z.output<typeof aboutSchema>, FindingAbout>;
true satisfies Same<z.output<typeof fixSchema>, FindingFix>;

const findingSchema = z.strictObject({
  id: z.number(),
  patroller: z.enum(PATROLLER_IDS),
  about: aboutSchema,
  fix: fixSchema.nullable(),
  subject: z.strictObject({
    entity: z.enum(["page", "block", "sharedContent", "repeatableItem", "record", "file"]),
    id: z.string(),
    name: z.string(),
  }),
  locale: z.string(),
  field: z.string(),
});

const listInput = z.object({});
const applyInput = z.object({
  findingId: z.number().describe("The finding's `id`, as listFindings returns it."),
});

export const findingsProvider: ToolProvider = (ctx): ToolDefinition[] => [
  defineTool({
    name: "listFindings",
    description:
      "List the open findings in the current draft: problems the Patrol's patrollers found in " +
      "what the draft changed, like a link to a page that no longer exists, which hold its " +
      "publish until fixed or dismissed by a member. Returns `{ findings }`, the oldest first, " +
      "each with its `id`, the `patroller` that raised it, what it's `about` (by `kind`: " +
      "`missingPage` and `brokenLink` name the link's `url` and the `text` it reads; " +
      "`misspelling` and `grammar` the flagged `text` and its `sentence`), the `fix` it " +
      "suggests or null, and where it is: its `subject` (`entity`, `id`, `name`), `locale` tag " +
      "and content `field`. On Live, lists Live's findings. You can't dismiss a finding: only " +
      "members can, from the Patrol.",
    inputSchema: listInput,
    outputSchema: z.strictObject({ findings: z.array(findingSchema) }),
    meta: { kind: "read", surfaces: ["cli", "studio-agent"] },
    handler: async () =>
      runService(
        openFindings(ctx, { projectId: ctx.projectId }).pipe(
          Effect.map((found) => ({
            findings: found.map(({ id, patroller, about, fix, subject, locale, field }) => ({
              id,
              patroller,
              about,
              fix,
              subject,
              locale,
              field,
            })),
          })),
        ),
      ),
  }),
  defineTool({
    name: "applyFindingFix",
    description:
      "Apply the fix a finding of the current draft suggests (its `fix`, from listFindings), as " +
      "a member would from the Patrol: `removeLink` unwraps the link, keeping its text, and " +
      "`replaceText` replaces the flagged text with its `replacement`. Returns " +
      "`{ applied: true }` once applied, which resolves the finding. When its content changed " +
      "since the finding was raised, nothing is applied and it returns `{ applied: false }`: the " +
      "draft is checked again, so list its findings again later. A finding without a `fix` " +
      "needs editing its content yourself.",
    inputSchema: applyInput,
    outputSchema: z.strictObject({ applied: z.boolean() }),
    meta: { kind: "write", surfaces: ["cli", "studio-agent"] },
    handler: async (input) => {
      const { findingId } = applyInput.parse(input);
      return runService(applyFix(ctx, { projectId: ctx.projectId, findingId }));
    },
  }),
];
