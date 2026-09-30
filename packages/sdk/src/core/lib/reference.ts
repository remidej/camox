import type { Static, TSchema } from "@sinclair/typebox";
import type * as React from "react";

import type { EmbedURL, FileValue, ImageValue, ReferenceSchema } from "./contentType";
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

export type ReferenceScope<T extends Record<string, TSchema>> = {
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

export type ReferenceContent<T extends TSchema> = T extends ReferenceSchema<infer C> ? C : never;

/** A source identity is never used as an occurrence identity. */
export function referenceOccurrenceId(blockId: number, fieldName: string) {
  return `${blockId}__${fieldName}`;
}

export type ReferenceRecord = {
  id: string;
  collectionId: string;
  label: string;
  content: Record<string, unknown>;
  version?: number;
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
