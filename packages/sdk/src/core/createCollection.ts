import { SYSTEM_ORDER_KEYS, type SystemOrderKey } from "@camox/api-contract";
import { Type as TypeBox, type Static, type TObject, type TSchema } from "@sinclair/typebox";

import type { LayoutCollectionItemResult, LayoutRoutesResult, RecordPages } from "./createLayout";
import {
  collectionFieldBuilder,
  type CollectionFieldBuilder,
  type StringField,
} from "./lib/contentType";
import { notFound } from "./notFound";
import { getRecordLookup, type LayoutRequestContext } from "./requestContext";

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
  const id = options.id;
  return {
    pages({ by, param }) {
      // Uniqueness isn't enforced: a page showing one of several matching records would be wrong.
      const ambiguousValue = (ids: string[], value: string) =>
        new Error(`Collection "${id}": records ${ids.join(", ")} all have ${by} "${value}"`);
      return {
        async loader({ params, context }) {
          const value = params[param];
          // A path segment is never empty and never contains a slash.
          if (!value || value.includes("/")) throw notFound();
          const records = await getRecordLookup(context).findByField({
            collectionId: id,
            field: by,
            value,
          });
          if (records.length > 1)
            throw ambiguousValue(
              records.map((record) => record.id),
              value,
            );
          const [record] = records;
          if (!record) throw notFound();
          return {
            kind: "collection-item",
            collectionId: id,
            data: {
              id: record.id,
              content: record.content as Static<TObject<T>>,
              ...(record.references && { references: record.references }),
              ...(record.updatedAt != null && { updatedAt: record.updatedAt }),
            },
          };
        },
        async routes({ context }) {
          const records = await getRecordLookup(context).listPageValues({
            collectionId: id,
            field: by,
          });
          const idsByValue = new Map<string, string[]>();
          for (const record of records)
            idsByValue.set(record.value, [...(idsByValue.get(record.value) ?? []), record.id]);
          for (const [value, ids] of idsByValue)
            if (ids.length > 1) throw ambiguousValue(ids, value);
          return {
            data: records.map((record) => ({
              params: { [param]: record.value } as Record<typeof param, string>,
              target: {
                kind: "collection-item",
                collectionId: id,
                id: record.id,
                label: record.label,
              },
            })),
          };
        },
        recordPages: { collectionId: id, field: by },
      };
    },
    _internal: {
      id,
      title: options.title,
      description: options.description,
      label: options.label as string as TextKey<T>,
      contentSchema: TypeBox.Object(content, { additionalProperties: false }),
    },
  };
}

/** The pages of a derived layout, one per record, found by the record's `by` field. */
export interface CollectionPages<T extends Record<string, TSchema>, Param extends string> {
  loader: (input: {
    params: { [K in Param]: string };
    context: LayoutRequestContext;
  }) => Promise<LayoutCollectionItemResult<Static<TObject<T>>, string, T>>;
  routes: (input: {
    context: LayoutRequestContext;
  }) => Promise<LayoutRoutesResult<{ [K in Param]: string }>>;
  /** Synced to the API, which checks no two records share the value pages are found by. */
  recordPages: RecordPages;
}

/** The default erases the schema for heterogeneous app registries. */
export type Collection<T extends Record<string, TSchema> = any> = {
  /**
   * A record page's `loader` and `routes`, to spread into a derived layout whose route has
   * `param`. Each page renders the record whose String field `by` equals the param.
   */
  pages: <const Param extends string>(options: {
    by: TextKey<T>;
    param: Param;
  }) => CollectionPages<T, Param>;
  _internal: {
    id: string;
    title: string;
    description: string;
    label: TextKey<T>;
    contentSchema: TObject<T>;
  };
};
