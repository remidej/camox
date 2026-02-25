import {
  Type as TypeBoxType,
  type TSchema,
  type TUnsafe,
  type TArray,
  type TObject,
} from "@sinclair/typebox";
import type { FieldType } from "./fieldTypes.tsx";

/* -------------------------------------------------------------------------------------------------
 * EmbedURL branded type
 * -----------------------------------------------------------------------------------------------*/

declare const EmbedURLBrand: unique symbol;
export type EmbedURL = string & { readonly [EmbedURLBrand]: true };

/* -------------------------------------------------------------------------------------------------
 * LinkValue branded type
 * -----------------------------------------------------------------------------------------------*/

declare const LinkBrand: unique symbol;
export type LinkValue = (
  | { type: "external"; href: string }
  | { type: "page"; pageId: string }
) & { text: string; newTab: boolean } & {
  readonly [LinkBrand]: true;
};

/* -------------------------------------------------------------------------------------------------
 * ImageValue branded type
 * -----------------------------------------------------------------------------------------------*/

export type ImageValue = {
  url: string;
  alt: string;
  filename: string;
  mimeType: string;
} & { readonly __brand: "ImageValue" };

/* -------------------------------------------------------------------------------------------------
 * FileValue branded type
 * -----------------------------------------------------------------------------------------------*/

export type FileValue = {
  url: string;
  alt: string;
  filename: string;
  mimeType: string;
} & { readonly __brand: "FileValue" };

/* -------------------------------------------------------------------------------------------------
 * Typebox wrapper used for content schemas
 * -----------------------------------------------------------------------------------------------*/

/* -------------------------------------------------------------------------------------------------
 * Image / File type builders (overloaded for single vs multiple)
 * -----------------------------------------------------------------------------------------------*/

function _imageType(options: {
  title?: string;
  multiple: true;
  defaultItems: number;
}): TArray<TObject<{ image: TUnsafe<ImageValue> }>>;
function _imageType(options: {
  title?: string;
  multiple?: false;
}): TUnsafe<ImageValue>;
function _imageType(options: {
  title?: string;
  multiple?: boolean;
  defaultItems?: number;
}): TArray<TObject<{ image: TUnsafe<ImageValue> }>> | TUnsafe<ImageValue> {
  const imageDefault = {
    url: `https://placehold.co/1200x800/f4f4f5/a1a1aa.png?text=${options?.title || "image"}`,
    alt: "",
    filename: "placeholder.png",
    mimeType: "image/png",
  };

  const singleSchema = TypeBoxType.Unsafe<ImageValue>({
    type: "object",
    properties: {
      url: { type: "string" },
      alt: { type: "string" },
      filename: { type: "string" },
      mimeType: { type: "string" },
    },
    accept: ["image/*"],
    default: imageDefault,
    title: options.title,
    fieldType: "Image" as const,
  });

  if (!options.multiple) {
    return singleSchema;
  }

  const defaultItems = options.defaultItems ?? 0;
  const itemSchema = TypeBoxType.Object({ image: singleSchema });
  const defaultArray = Array.from({ length: defaultItems }, () => ({
    image: imageDefault,
  }));
  return TypeBoxType.Array(itemSchema, {
    minItems: 0,
    maxItems: 100,
    default: defaultArray,
    title: options.title,
    fieldType: "RepeatableObject" as const,
    arrayItemType: "Image" as const,
  });
}

function _fileType(options: {
  accept: string[];
  title?: string;
  multiple: true;
  defaultItems: number;
}): TArray<TObject<{ file: TUnsafe<FileValue> }>>;
function _fileType(options: {
  accept: string[];
  title?: string;
  multiple?: false;
}): TUnsafe<FileValue>;
function _fileType(options: {
  accept: string[];
  title?: string;
  multiple?: boolean;
  defaultItems?: number;
}): TArray<TObject<{ file: TUnsafe<FileValue> }>> | TUnsafe<FileValue> {
  const fileDefault = {
    url: "https://placehold.co/file-placeholder",
    alt: "",
    filename: "placeholder",
    mimeType: "application/octet-stream",
  };

  const singleSchema = TypeBoxType.Unsafe<FileValue>({
    type: "object",
    properties: {
      url: { type: "string" },
      alt: { type: "string" },
      filename: { type: "string" },
      mimeType: { type: "string" },
    },
    accept: options.accept,
    default: fileDefault,
    title: options.title,
    fieldType: "File" as const,
  });

  if (!options.multiple) {
    return singleSchema;
  }

  const defaultItems = options.defaultItems ?? 0;
  const itemSchema = TypeBoxType.Object({ file: singleSchema });
  const defaultArray = Array.from({ length: defaultItems }, () => ({
    file: fileDefault,
  }));
  return TypeBoxType.Array(itemSchema, {
    minItems: 0,
    maxItems: 100,
    default: defaultArray,
    title: options.title,
    fieldType: "RepeatableObject" as const,
    arrayItemType: "File" as const,
  });
}

/**
 * Type builders for createBlock content schemas.
 * All fields must have default values.
 */
export const Type = {
  /**
   * Creates a string field with a required default value.
   *
   * @example
   * Type.String({ default: 'Hello' })
   * Type.String({ default: 'Hello', maxLength: 100, title: 'Title' })
   */
  String: (options: {
    default: string;
    title?: string;
    maxLength?: number;
    minLength?: number;
    pattern?: string;
  }) => {
    return TypeBoxType.String({
      ...options,
      fieldType: "String" as const,
    });
  },

  /**
   * Creates a repeatable array of objects.
   * Arrays and objects must always be used together - no standalone arrays or objects.
   * The default array is auto-generated based on minItems.
   *
   * @example
   * Type.RepeatableObject({
   *   title: Type.String({ default: 'Item' }),
   *   description: Type.String({ default: 'Description' })
   * }, {
   *   minItems: 1,
   *   maxItems: 10,
   *   title: 'Items'
   * })
   */
  RepeatableObject: <T extends Record<string, TSchema>>(
    shape: T,
    options: { minItems: number; maxItems: number; title?: string },
  ) => {
    if (options.minItems < 1) {
      throw new Error("RepeatableObject requires minItems to be at least 1");
    }

    const objectSchema = TypeBoxType.Object(shape);

    // Extract defaults manually since Value.Create doesn't support Unsafe types (used by Type.Enum, Type.Embed, Type.Link)
    const defaultItem: Record<string, unknown> = {};
    for (const [key, prop] of Object.entries(objectSchema.properties)) {
      if ("default" in prop) {
        defaultItem[key] = (prop as { default: unknown }).default;
      }
    }
    const defaultArray = Array(options.minItems)
      .fill(null)
      .map(() => ({ ...defaultItem }));

    return TypeBoxType.Array(objectSchema, {
      minItems: options.minItems,
      maxItems: options.maxItems,
      default: defaultArray,
      title: options.title,
      fieldType: "RepeatableObject" as const,
    });
  },

  /**
   * Creates an enum field with a set of predefined options.
   *
   * @example
   * Type.Enum({
   *   default: 'left',
   *   options: { left: 'Left', center: 'Center', right: 'Right' },
   *   title: 'Alignment'
   * })
   */
  Enum: (options: {
    default: string;
    options: Record<string, string>;
    title?: string;
  }) => {
    const enumValues = Object.keys(options.options);
    return TypeBoxType.Unsafe<string>({
      type: "string",
      enum: enumValues,
      default: options.default,
      title: options.title,
      enumLabels: options.options,
      fieldType: "Enum" as const,
    });
  },

  /**
   * Creates a boolean toggle field.
   *
   * @example
   * Type.Boolean({ default: false, title: 'Show background' })
   */
  Boolean: (options: { default: boolean; title?: string }) => {
    return TypeBoxType.Boolean({
      default: options.default,
      title: options.title,
      fieldType: "Boolean" as const,
    });
  },

  /**
   * Creates an embed field for URLs matching a specific pattern.
   *
   * @example
   * Type.Embed({
   *   pattern: 'https:\\/\\/(www\\.)?youtube\\.com\\/watch\\?v=.+',
   *   default: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
   *   title: 'YouTube URL'
   * })
   */
  Embed: (options: { pattern: string; default: string; title?: string }) => {
    if (!new RegExp(options.pattern).test(options.default)) {
      throw new Error(
        `Embed default value "${options.default}" does not match pattern "${options.pattern}"`,
      );
    }
    return TypeBoxType.Unsafe<EmbedURL>({
      type: "string",
      pattern: options.pattern,
      default: options.default,
      title: options.title,
      fieldType: "Embed" as const,
    });
  },

  /**
   * Creates a link field with text, href/pageId, and newTab properties.
   * Supports both external URLs and internal page links.
   *
   * @example
   * Type.Link({ default: { text: 'Learn more', href: '/', newTab: false }, title: 'CTA' })
   */
  Link: (options: {
    default: { text: string; href: string; newTab: boolean };
    title?: string;
  }) => {
    return TypeBoxType.Unsafe<LinkValue>({
      type: "object",
      properties: {
        type: { type: "string", enum: ["external", "page"] },
        text: { type: "string" },
        href: { type: "string" },
        pageId: { type: "string" },
        newTab: { type: "boolean" },
      },
      default: { ...options.default, type: "external" },
      title: options.title,
      fieldType: "Link" as const,
    });
  },

  Image: _imageType,

  File: _fileType,
} satisfies Record<FieldType, unknown>;
