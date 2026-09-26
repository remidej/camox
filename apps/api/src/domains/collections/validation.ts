import { ORPCError } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { files } from "../../schema";
import type { ServiceContext } from "../_shared/service-context";
import { validateText } from "./text-content";

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
    ]),
    type: z.string(),
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
  })
  .strict();

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
      let expected = "object";
      if (["String", "Enum", "Embed"].includes(field.fieldType)) expected = "string";
      if (field.fieldType === "Boolean") expected = "boolean";
      if (["ImageList", "FileList", "Repeater"].includes(field.fieldType)) expected = "array";
      if (field.type !== expected)
        ctx.addIssue({ code: "custom", message: `${key}: invalid field type` });
      if (field.fieldType.endsWith("List")) {
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
async function validateAsset(
  ctx: ServiceContext,
  projectId: number,
  environmentId: number,
  field: z.infer<typeof property>,
  value: unknown,
) {
  let asset = assetInput.parse(value);
  if (asset._fileId) {
    const file = await ctx.db
      .select()
      .from(files)
      .where(
        and(
          eq(files.id, Number(asset._fileId)),
          eq(files.projectId, projectId),
          eq(files.environmentId, environmentId),
        ),
      )
      .get();
    if (!file)
      throw new ORPCError("BAD_REQUEST", {
        message: "Asset is outside this site/environment or missing",
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
    throw new ORPCError("BAD_REQUEST", { message: "Image requires an image asset" });
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
    throw new ORPCError("BAD_REQUEST", { message: "Asset MIME type is not accepted" });
  }
  return asset;
}

export async function validateContent(
  ctx: ServiceContext,
  definition: { projectId: number; environmentId: number; contentSchema: unknown },
  value: unknown,
): Promise<Record<string, unknown>> {
  try {
    return await validateContentFields(ctx, definition, value);
  } catch (error) {
    if (!(error instanceof z.ZodError)) throw error;
    throw new ORPCError("BAD_REQUEST", {
      message: `Invalid collection content: ${error.issues.map((issue) => issue.message).join("; ")}`,
      cause: error,
    });
  }
}

async function validateContentFields(
  ctx: ServiceContext,
  definition: { projectId: number; environmentId: number; contentSchema: unknown },
  value: unknown,
): Promise<Record<string, unknown>> {
  const schema = contentSchemaInput.parse(definition.contentSchema);
  const content = z.record(z.string(), z.unknown()).parse(value);
  if (Object.keys(content).some((key) => !Object.hasOwn(schema.properties, key))) {
    throw new ORPCError("BAD_REQUEST", { message: "Unknown collection content field" });
  }
  const result: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(schema.properties)) {
    const value = content[key];
    if (["String", "Embed", "Enum"].includes(field.fieldType)) {
      const authored =
        field.fieldType === "String"
          ? await validateText(ctx, definition, value)
          : { value, text: value };
      let validator = z.string();
      if (field.minLength !== undefined) validator = validator.min(field.minLength);
      if (field.maxLength !== undefined) validator = validator.max(field.maxLength);
      if (field.pattern) validator = validator.regex(new RegExp(field.pattern));
      const text = validator.parse(authored.text);
      if (field.enum && !field.enum.includes(text))
        throw new ORPCError("BAD_REQUEST", { message: `${key}: invalid enum value` });
      result[key] = authored.value;
      continue;
    }
    if (field.fieldType === "Boolean") {
      result[key] = z.boolean().parse(value);
      continue;
    }
    if (field.fieldType.endsWith("List")) {
      const values = z
        .array(z.unknown())
        .min(field.minItems ?? 0)
        .max(field.maxItems ?? 100)
        .parse(value);
      const item = property.parse(field.items);
      result[key] = await Promise.all(
        values.map((value) =>
          validateAsset(ctx, definition.projectId, definition.environmentId, item, value),
        ),
      );
      continue;
    }
    // An unlinked single asset is stored as null. Preview placeholders are never data.
    result[key] =
      value === null
        ? null
        : await validateAsset(ctx, definition.projectId, definition.environmentId, field, value);
  }
  return result;
}
