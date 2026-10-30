import { artifactSourceTitle, UNTITLED_ARTIFACT } from "@camox/api-contract";
import { uuidv7Schema } from "@camox/api-contract/ids";
import { Effect } from "effect";
import { z } from "zod";

import { decodeInput, InvalidInputError, NotFoundError } from "../../lib/errors";
import { fieldOf } from "../_shared/fields";
import type { ServiceContext } from "../_shared/service-context";
import { loadBlockSchemas } from "../blocks/content-schema";
import { editBlock, getBlock } from "../blocks/service";
import { accessTo } from "../drafts/access";
import { updateRepeatableItemContent } from "../repeatable-items/service";

/**
 * One artifact field: of a block's own content, or of one of its Repeatable Items, at any depth.
 * The locale is the service context's.
 */
export const artifactFieldSchema = z.object({
  block: uuidv7Schema,
  item: uuidv7Schema.optional(),
  field: z.string().min(1),
});
export type ArtifactField = z.infer<typeof artifactFieldSchema>;

/** Where an artifact field is, as `readArtifactField` found it: its block, its holder's content. */
const locate = Effect.fn("artifactField.locate")(function* (
  ctx: ServiceContext,
  rawInput: ArtifactField,
) {
  const input = yield* decodeInput(artifactFieldSchema, rawInput);
  const bundle = yield* getBlock(ctx, { id: input.block });
  const { project, scope } = yield* accessTo(ctx, { block: input.block }, "public");
  const schemas = yield* loadBlockSchemas(ctx.db, project.id, input.block, scope);
  let schema: unknown = schemas?.contentSchema;
  let content = bundle.block.content as Record<string, unknown>;
  if (input.item) {
    const items = bundle.repeatableItems;
    const item = items.find(({ id }) => id === input.item);
    if (!item) {
      return yield* new NotFoundError({
        message: `The block ${input.block} has no repeatable item ${input.item}`,
      });
    }
    // The repeater field names from the block down to the item, which its schema descends.
    const path: string[] = [];
    let at: typeof item | undefined = item;
    while (at) {
      path.unshift(at.fieldName);
      const parent: string | null = at.parentItemId;
      at = items.find(({ id }) => id === parent);
    }
    for (const name of path) {
      const repeater = fieldOf(schema, name);
      schema = repeater?.kind === "Repeater" ? repeater.itemContentSchema : undefined;
    }
    content = item.content as Record<string, unknown>;
  }
  if (fieldOf(schema, input.field)?.kind !== "Artifact") {
    return yield* new InvalidInputError({
      message: `\`${input.field}\` isn't an artifact field of ${input.item ? "that repeatable item" : "that block"}`,
    });
  }
  return { input, block: bundle.block, content };
}, Effect.scoped);

/** An artifact field's source, as the context's draft and locale read it: empty when unset. */
export const readArtifactField = Effect.fn("artifactField.read")(function* (
  ctx: ServiceContext,
  input: ArtifactField,
) {
  const { content } = yield* locate(ctx, input);
  const value = content[input.field];
  return typeof value === "string" ? value : "";
}, Effect.scoped);

/**
 * Sets an artifact field's source, in the context's draft and locale, as content writes do: the
 * write is checked against the field's schema, and the source is stored. Returns the block it
 * belongs to, for what the write touched, and a warning for a source without a `<title>`.
 */
export const writeArtifactField = Effect.fn("artifactField.write")(function* (
  ctx: ServiceContext,
  input: ArtifactField & { source: string },
) {
  const { block } = yield* locate(ctx, input);
  const content = { [input.field]: input.source };
  if (input.item) yield* updateRepeatableItemContent(ctx, { id: input.item, content });
  else yield* editBlock(ctx, { id: input.block, content });
  const untitled = input.source.trim() !== "" && !artifactSourceTitle(input.source);
  return {
    block,
    warnings: untitled
      ? [
          `The source has no non-empty <title>, so it is called "${UNTITLED_ARTIFACT}". Add a ` +
            "meaningful <title>: it names the artifact for screen readers and is its Markdown " +
            "Representation.",
        ]
      : [],
  };
}, Effect.scoped);
