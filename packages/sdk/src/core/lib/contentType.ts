import {
  Type as TypeBoxType,
  type TSchema,
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
 * MediaValue branded type
 * -----------------------------------------------------------------------------------------------*/

declare const MediaBrand: unique symbol;
export type MediaValue = {
  url: string;
  alt: string;
  filename: string;
  mimeType: string;
} & { readonly [MediaBrand]: true };

/* -------------------------------------------------------------------------------------------------
 * Typebox wrapper used for content schemas
 * -----------------------------------------------------------------------------------------------*/

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

  /**
   * Creates a media field for images, videos, or other file assets.
   * The `accept` array uses MIME type patterns (same as HTML `<input accept>`).
   *
   * @example
   * Type.Media({ accept: ['image/*'], title: 'Cover image' })
   * Type.Media({ accept: ['image/*', 'video/*'], title: 'Hero media' })
   * Type.Media({ accept: ['application/pdf'], title: 'Document' })
   */
  Media: (options: { accept: string[]; title?: string }) => {
    return TypeBoxType.Unsafe<MediaValue | null>({
      type: ["object", "null"],
      properties: {
        url: { type: "string" },
        alt: { type: "string" },
        filename: { type: "string" },
        mimeType: { type: "string" },
      },
      accept: options.accept,
      default: null,
      title: options.title,
      fieldType: "Media" as const,
    });
  },
} satisfies Record<FieldType, unknown>;
