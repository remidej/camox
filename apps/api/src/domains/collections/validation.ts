import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { z } from "zod";

import { InvalidInputError } from "../../lib/errors";
import { files } from "../../schema";
import type { ServiceContext } from "../_shared/service-context";
import { missingReference, recordInScope } from "./references";
import { decodeContent, validateText } from "./text-content";

const property = z
  .object({
    fieldType: z.enum([
      "String",
      "Boolean",
      "Enum",
      "Embed",
      "Image",
      "File",
      "ImageList",
      "FileList",
      "Link",
      "Repeater",
      "Reference",
      "ReferenceList",
    ]),
    // References are nullable through `anyOf` rather than a single `type`.
    type: z.string().optional(),
    anyOf: z.unknown().optional(),
    title: z.string().optional(),
    default: z.unknown().optional(),
    minLength: z.number().int().nonnegative().optional(),
    maxLength: z.number().int().nonnegative().optional(),
    pattern: z.string().optional(),
    enum: z.array(z.string()).nonempty().optional(),
    properties: z.record(z.string(), z.unknown()).optional(),
    items: z.unknown().optional(),
    minItems: z.number().int().nonnegative().optional(),
    maxItems: z.number().int().nonnegative().optional(),
    accept: z.array(z.string()).optional(),
    enumLabels: z.record(z.string(), z.string()).optional(),
    defaultItems: z.number().optional(),
    toMarkdown: z.array(z.string()).optional(),
    itemSettingsSchema: z.unknown().optional(),
    defaultItemSettings: z.unknown().optional(),
    description: z.string().optional(),
    collectionId: z.string().min(1).optional(),
    // Collection references are never required: unpublished targets resolve empty.
    required: z.literal(false).optional(),
    referenceSchema: z.unknown().optional(),
    labelField: z.string().optional(),
  })
  .strict();

const isReference = (fieldType: string) =>
  fieldType === "Reference" || fieldType === "ReferenceList";

export const contentSchemaInput = z
  .object({
    type: z.literal("object"),
    properties: z.record(z.string(), property),
    required: z.array(z.string()),
    additionalProperties: z.literal(false),
  })
  .strict()
  .superRefine((schema, ctx) => {
    const keys = Object.keys(schema.properties);
    if (
      schema.required.length !== keys.length ||
      keys.some((key) => !schema.required.includes(key))
    ) {
      ctx.addIssue({ code: "custom", message: "All collection fields must be required" });
    }
    for (const [key, field] of Object.entries(schema.properties)) {
      if (["__proto__", "constructor", "prototype"].includes(key)) {
        ctx.addIssue({ code: "custom", message: `${key}: reserved field name` });
      }
      let expected: string | undefined = "object";
      if (["String", "Enum", "Embed"].includes(field.fieldType)) expected = "string";
      if (field.fieldType === "Boolean") expected = "boolean";
      if (["ImageList", "FileList", "Repeater", "ReferenceList"].includes(field.fieldType))
        expected = "array";
      if (field.fieldType === "Reference") expected = undefined;
      if (field.type !== expected)
        ctx.addIssue({ code: "custom", message: `${key}: invalid field type` });
      if (isReference(field.fieldType) !== (field.collectionId !== undefined))
        ctx.addIssue({ code: "custom", message: `${key}: only references name a collection` });
      if (field.fieldType === "ImageList" || field.fieldType === "FileList") {
        const item = property.safeParse(field.items);
        if (!item.success || item.data.fieldType !== field.fieldType.replace("List", "")) {
          ctx.addIssue({ code: "custom", message: `${key}: invalid asset list item schema` });
        }
      }
      if (field.fieldType === "Repeater" || field.fieldType === "Link") {
        ctx.addIssue({
          code: "custom",
          message: `${key}: ${field.fieldType} storage is not supported in collections yet`,
        });
      }
      if (field.fieldType === "Enum" && !field.enum)
        ctx.addIssue({ code: "custom", message: `${key}: missing enum` });
      if (field.pattern) {
        try {
          new RegExp(field.pattern);
        } catch {
          ctx.addIssue({ code: "custom", message: `${key}: invalid pattern` });
        }
      }
    }
  });

export const collectionDefinitionInput = z
  .object({
    collectionId: z.string().min(1),
    title: z.string().min(1),
    description: z.string(),
    label: z.string(),
    contentSchema: contentSchemaInput,
  })
  .strict()
  .superRefine((definition, ctx) => {
    if (definition.contentSchema.properties[definition.label]?.fieldType !== "String") {
      ctx.addIssue({ code: "custom", message: "Label must name a String field" });
    }
  });

const assetInput = z
  .object({
    url: z.url().refine((url) => ["https:", "http:"].includes(new URL(url).protocol)),
    alt: z.string(),
    filename: z.string(),
    mimeType: z.string(),
    size: z.number().int().nonnegative().optional(),
    _fileId: z
      .string()
      .regex(/^[1-9]\d*$/)
      .optional(),
  })
  .strict();

/** Materialize managed assets once; snapshots never dereference mutable file metadata. */
const validateAsset = Effect.fn("collections.validateAsset")(function* (
  ctx: ServiceContext,
  projectId: number,
  environmentId: number,
  field: z.infer<typeof property>,
  value: unknown,
) {
  let asset = yield* decodeContent(assetInput, value);
  if (asset._fileId) {
    const fileId = Number(asset._fileId);
    const file = yield* Effect.promise(() =>
      ctx.db
        .select()
        .from(files)
        .where(
          and(
            eq(files.id, fileId),
            eq(files.projectId, projectId),
            eq(files.environmentId, environmentId),
          ),
        )
        .get(),
    );
    if (!file)
      return yield* new InvalidInputError({
        message: "Asset is outside this project/environment or missing",
      });
    asset = {
      url: file.url,
      alt: asset.alt,
      filename: file.filename,
      mimeType: file.mimeType,
      size: file.size,
      _fileId: String(file.id),
    };
  }
  if (field.fieldType.startsWith("Image") && !asset.mimeType.startsWith("image/")) {
    return yield* new InvalidInputError({ message: "Image requires an image asset" });
  }
  if (
    field.accept?.length &&
    !field.accept.some((type) => {
      if (type === "*/*") return true;
      if (type.startsWith(".")) return asset.filename.toLowerCase().endsWith(type.toLowerCase());
      if (type.endsWith("/*")) return asset.mimeType.startsWith(type.slice(0, -1));
      return asset.mimeType === type;
    })
  ) {
    return yield* new InvalidInputError({ message: "Asset MIME type is not accepted" });
  }
  return asset;
});

export const validateContent = Effect.fn("collections.validateContent")(function* (
  ctx: ServiceContext,
  definition: { projectId: number; environmentId: number; contentSchema: unknown },
  value: unknown,
) {
  const schema = yield* decodeContent(contentSchemaInput, definition.contentSchema);
  const content = yield* decodeContent(z.record(z.string(), z.unknown()), value);
  if (Object.keys(content).some((key) => !Object.hasOwn(schema.properties, key))) {
    return yield* new InvalidInputError({ message: "Unknown collection content field" });
  }
  const result: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(schema.properties)) {
    const value = content[key];
    if (field.fieldType === "Reference") {
      const id = yield* decodeContent(z.uuid().nullable(), value);
      if (id !== null && !(yield* recordInScope(ctx, definition, field, id)))
        return yield* missingReference(key);
      result[key] = id;
      continue;
    }
    if (field.fieldType === "ReferenceList") {
      const ids = yield* decodeContent(z.array(z.uuid()).max(field.maxItems ?? 100), value);
      if (new Set(ids).size !== ids.length)
        return yield* new InvalidInputError({
          message: `${key}: reference list links the same record more than once`,
        });
      for (const id of ids) {
        if (!(yield* recordInScope(ctx, definition, field, id)))
          return yield* missingReference(key);
      }
      result[key] = ids;
      continue;
    }
    if (["String", "Embed", "Enum"].includes(field.fieldType)) {
      const authored =
        field.fieldType === "String"
          ? yield* validateText(ctx, definition, value)
          : { value, text: value };
      let validator = z.string();
      if (field.minLength !== undefined) validator = validator.min(field.minLength);
      if (field.maxLength !== undefined) validator = validator.max(field.maxLength);
      if (field.pattern) validator = validator.regex(new RegExp(field.pattern));
      const text = yield* decodeContent(validator, authored.text);
      if (field.enum && !field.enum.includes(text))
        return yield* new InvalidInputError({ message: `${key}: invalid enum value` });
      result[key] = authored.value;
      continue;
    }
    if (field.fieldType === "Boolean") {
      result[key] = yield* decodeContent(z.boolean(), value);
      continue;
    }
    if (field.fieldType.endsWith("List")) {
      const values = yield* decodeContent(
        z
          .array(z.unknown())
          .min(field.minItems ?? 0)
          .max(field.maxItems ?? 100),
        value,
      );
      const item = yield* decodeContent(property, field.items);
      result[key] = yield* Effect.forEach(
        values,
        (value) => validateAsset(ctx, definition.projectId, definition.environmentId, item, value),
        { concurrency: "unbounded" },
      );
      continue;
    }
    // An unlinked single asset is stored as null. Preview placeholders are never data.
    result[key] =
      value === null
        ? null
        : yield* validateAsset(ctx, definition.projectId, definition.environmentId, field, value);
  }
  return result;
});
