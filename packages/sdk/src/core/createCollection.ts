import { Type as TypeBox, type TObject, type TSchema } from "@sinclair/typebox";

export { Type } from "./lib/contentType";

type TextKey<T extends Record<string, TSchema>> = {
  [K in keyof T & string]: T[K] extends { fieldType: "String" } ? K : never;
}[keyof T & string];

/** A definition only: record authoring and querying are not public SDK APIs. */
export function createCollection<const T extends Record<string, TSchema>>(options: {
  id: string;
  title: string;
  description: string;
  content: T;
  label: TextKey<NoInfer<T>>;
}): Collection<T> {
  if (!options.id.trim()) throw new Error("Collection id is required");
  const supported = new Set([
    "String",
    "Boolean",
    "Enum",
    "Embed",
    "Image",
    "File",
    "ImageList",
    "FileList",
  ]);
  for (const [key, field] of Object.entries(options.content)) {
    if (!supported.has(field.fieldType)) {
      throw new Error(
        `Collection "${options.id}" field "${key}": ${String(field.fieldType)} storage is not supported yet`,
      );
    }
  }
  if (options.content[options.label]?.fieldType !== "String") {
    throw new Error("Collection label must name a String field");
  }
  return {
    _internal: {
      id: options.id,
      title: options.title,
      description: options.description,
      label: options.label,
      contentSchema: TypeBox.Object(options.content, { additionalProperties: false }),
    },
  };
}

/** The default erases the schema for heterogeneous app registries. */
export type Collection<T extends Record<string, TSchema> = any> = {
  _internal: {
    id: string;
    title: string;
    description: string;
    label: TextKey<T>;
    contentSchema: TObject<T>;
  };
};
