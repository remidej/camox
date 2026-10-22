import {
  nonStringTemplateFields,
  SYSTEM_ORDER_KEYS,
  type SystemOrderKey,
} from "@camox/api-contract";
import { Type as TypeBox, type Static, type TObject, type TSchema } from "@sinclair/typebox";

import type { LayoutCollectionItemResult, LayoutRoutesResult, RecordPages } from "./createLayout";
import {
  collectionFieldBuilder,
  type CollectionFieldBuilder,
  type RecordStructuredDataContext,
  type RecordTemplateContext,
  resolveRecordStructuredData,
  resolveRecordTemplate,
} from "./lib/contentType";
import { notFound } from "./notFound";
import { getRecordLookup, type LayoutRequestContext } from "./requestContext";
import type { KnownPropertiesOnly, RecordNode } from "./structuredData";

export type { CollectionFieldBuilder };

/** Record metadata names, reserved so query `orderBy` keys stay unambiguous. */
type ReservedFieldNames = { [K in SystemOrderKey]?: never };

type TextKey<T extends Record<string, TSchema>> = {
  [K in keyof T & string]: T[K] extends { fieldType: "String" } ? K : never;
}[keyof T & string];

/**
 * A definition only: record authoring and querying are not public SDK APIs.
 *
 * `toTitle` and `toDescription` are templates of the record's String fields, such as
 * `` ({ content }) => `${content.firstName} ${content.lastName}` ``. The API fills them with each
 * record's plain text wherever records are named: studio lists and pickers, record pages,
 * `llms.txt` and agents. `toDescription` may return nothing, and records then have no description.
 */
export function createCollection<
  const T extends Record<string, TSchema> & ReservedFieldNames,
  Node extends RecordNode = RecordNode,
>(options: {
  id: string;
  title: string;
  description: string;
  content: (field: CollectionFieldBuilder) => T;
  toTitle: (context: RecordTemplateContext<NoInfer<T>>) => string;
  toDescription: (context: RecordTemplateContext<NoInfer<T>>) => string | undefined;
  /**
   * Each record's Structured Data node, from tokens of its fields, such as
   * `({ content }) => ({ "@type": "Person", jobTitle: content.role })`. Camox fills its name and
   * description from the record's title and description, and gives it an `@id` per record and
   * locale. Every page referencing the record links this one node, and on the record's own page
   * it's the main entity unless the layout declares one. A reference links the record's node.
   */
  toStructuredData?: (
    context: RecordStructuredDataContext<NoInfer<T>>,
  ) => Node & KnownPropertiesOnly<Node, RecordNode>;
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
  const toTitle = resolveRecordTemplate(options.toTitle, content);
  if (toTitle === null) throw new Error(`Collection "${options.id}": toTitle returned nothing`);
  const toDescription = resolveRecordTemplate(options.toDescription, content);
  for (const template of [toTitle, toDescription]) {
    // Templates read fields as plain text: a token of a reference's field names no field here.
    const [name] = nonStringTemplateFields(template ?? "", content);
    if (name !== undefined)
      throw new Error(`Collection "${options.id}": "${name}" names no String field`);
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
              ...(record.title !== undefined && { title: record.title }),
              ...(record.description !== undefined && { description: record.description }),
              content: record.content as Static<TObject<T>>,
              ...(record.references && { references: record.references }),
              ...(record.updatedAt != null && { updatedAt: record.updatedAt }),
            },
            ...(record.structuredData && { structuredData: record.structuredData }),
            ...(record.firstPublishedAt !== undefined && {
              published: { first: record.firstPublishedAt, last: record.publishedAt ?? null },
            }),
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
                title: record.title,
              },
            })),
          };
        },
        recordPages: { collectionId: id, field: by, param },
      };
    },
    _internal: {
      id,
      title: options.title,
      description: options.description,
      toTitle,
      toDescription,
      toStructuredData: options.toStructuredData
        ? resolveRecordStructuredData(options.toStructuredData, content)
        : null,
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
    /** The token template titling each record, such as `{{firstName}} {{lastName}}`. */
    toTitle: string;
    /** The token template describing each record, or null when records have no description. */
    toDescription: string | null;
    /** The JSON template of each record's Structured Data node, or null when records have none. */
    toStructuredData: Record<string, unknown> | null;
    contentSchema: TObject<T>;
  };
};
