import { Type as TypeBox, type TObject, type TSchema } from "@sinclair/typebox";

import {
  collectionFieldBuilder,
  SYSTEM_ORDER_KEYS,
  type CollectionFieldBuilder,
  type StringField,
  type SystemOrderKey,
} from "./lib/contentType";

export type { CollectionFieldBuilder };

/** Record metadata names, reserved so query `orderBy` keys stay unambiguous. */
type ReservedFieldNames = { [K in SystemOrderKey]?: never };

type TextKey<T extends Record<string, TSchema>> = {
  [K in keyof T & string]: T[K] extends { fieldType: "String" } ? K : never;
}[keyof T & string];

/**
 * A definition only: record authoring and querying are not public SDK APIs.
 * `label` is checked against `content`'s return type: typing it against `T` directly would fix
 * `T` before the `content` callback is inferred.
 */
export function createCollection<
  const T extends Record<string, TSchema> & ReservedFieldNames,
  const L extends string,
>(options: {
  id: string;
  title: string;
  description: string;
  content: (field: CollectionFieldBuilder) => T & Record<NoInfer<L>, StringField>;
  label: L;
}): Collection<T> {
  if (!options.id.trim()) throw new Error("Collection id is required");
  const content: T = options.content(collectionFieldBuilder);
  for (const key of SYSTEM_ORDER_KEYS) {
    if (Object.hasOwn(content, key)) {
      throw new Error(`Collection "${options.id}" field "${key}": reserved field name`);
    }
  }
  const supported = new Set([
    "String",
    "Boolean",
    "Enum",
    "Embed",
    "Image",
    "File",
    "ImageList",
    "FileList",
    "Reference",
    "ReferenceList",
  ]);
  for (const [key, field] of Object.entries(content)) {
    if (!supported.has(field.fieldType)) {
      throw new Error(
        `Collection "${options.id}" field "${key}": ${String(field.fieldType)} storage is not supported yet`,
      );
    }
  }
  if (content[options.label]?.fieldType !== "String") {
    throw new Error("Collection label must name a String field");
  }
  return {
    _internal: {
      id: options.id,
      title: options.title,
      description: options.description,
      label: options.label as string as TextKey<T>,
      contentSchema: TypeBox.Object(content, { additionalProperties: false }),
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
