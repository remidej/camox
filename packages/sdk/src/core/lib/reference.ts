import type { Static, TSchema } from "@sinclair/typebox";
import type * as React from "react";

import type {
  EmbedURL,
  FileValue,
  ImageValue,
  ReferenceListSchema,
  ReferenceSchema,
} from "./contentType";
import type { InlineTextStyles } from "./lexicalReact";

type Keys<T extends Record<string, TSchema>, V> = {
  [K in keyof T & string]: Static<T[K]> extends V ? K : never;
}[keyof T & string];
type TextKeys<T extends Record<string, TSchema>> = {
  [K in keyof T & string]: T[K] extends { fieldType: "String" } ? K : never;
}[keyof T & string];

type Primitive<K, P, D> = (props: {
  name: K;
  children: (props: P, data: D) => React.ReactNode;
}) => React.ReactNode;

/**
 * The typed scope of a placed record. A record placed by a block or item (the first hop) also
 * renders the records it links; those (the second hop) link nothing further.
 */
export type ReferenceScope<
  T extends Record<string, TSchema>,
  Nested extends boolean = true,
> = RecordFields<T> & (Nested extends true ? LinkedRecords<T> : unknown);

type LinkedRecords<T extends Record<string, TSchema>> = {
  Reference: <K extends ReferenceKeys<T>>(props: {
    name: K;
    children: (scope: ReferenceScope<ReferenceContent<T[K]>, false>) => React.ReactNode;
  }) => React.ReactNode;
  ReferenceList: <K extends ReferenceListKeys<T>>(props: {
    name: K;
    children: (scope: ReferenceScope<ReferenceContent<T[K]>, false>) => React.ReactNode;
  }) => React.ReactNode;
};

type RecordFields<T extends Record<string, TSchema>> = {
  id: string;
  label: string;
  Field: (
    props: InlineTextStyles & {
      name: TextKeys<T>;
      children: (
        props: React.HTMLAttributes<HTMLElement> & { ref?: React.Ref<any> },
        data: { text: string },
      ) => React.ReactNode;
    },
  ) => React.ReactNode;
  Image: Primitive<
    Keys<T, ImageValue>,
    { src: string; alt: string; srcSet?: string; sizes?: string },
    ImageValue
  >;
  File: Primitive<Keys<T, FileValue>, { href: string; download: string }, FileValue>;
  Embed: Primitive<Keys<T, EmbedURL>, { src: string }, { url: string }>;
  ImageList: Primitive<
    Keys<T, ImageValue[]>,
    { src: string; alt: string; srcSet?: string; sizes?: string },
    ImageValue
  >;
  FileList: Primitive<Keys<T, FileValue[]>, { href: string; download: string }, FileValue>;
};

export type ReferenceKeys<T extends Record<string, TSchema>> = {
  [K in keyof T & string]: T[K] extends ReferenceSchema<any> ? K : never;
}[keyof T & string];

export type ReferenceListKeys<T extends Record<string, TSchema>> = {
  [K in keyof T & string]: T[K] extends ReferenceListSchema<any> ? K : never;
}[keyof T & string];

export type ReferenceContent<T extends TSchema> =
  T extends ReferenceSchema<infer C> ? C : T extends ReferenceListSchema<infer C> ? C : never;

export type ReferenceRecord = {
  id: string;
  collectionId: string;
  label: string;
  content: Record<string, unknown>;
  version?: number;
  /** The records this record links, when it was placed at the first hop. */
  references?: Record<string, ReferenceRecord | ReferenceRecord[] | null>;
};

export function resolveReference(
  value: unknown,
  collectionId: string,
  records: ReadonlyMap<string, ReferenceRecord>,
): ReferenceRecord | null {
  if (typeof value !== "string") return null;
  const record = records.get(value);
  return record?.collectionId === collectionId ? record : null;
}

/** The record ids a reference list value links, in stored order; anything else links none. */
export function referenceListIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((id): id is string => typeof id === "string" && id !== "");
}

/** The records a reference list links, in stored order; unresolved ids are skipped. */
export function resolveReferenceList(
  value: unknown,
  collectionId: string,
  records: ReadonlyMap<string, ReferenceRecord>,
): ReferenceRecord[] {
  return referenceListIds(value)
    .map((id) => resolveReference(id, collectionId, records))
    .filter((record) => record !== null);
}
