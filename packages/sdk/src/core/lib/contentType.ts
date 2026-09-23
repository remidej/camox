import {
  Type as TypeBoxType,
  type TSchema,
  type Static,
  type TUnsafe,
  type TArray,
  type TObject,
} from "@sinclair/typebox";

import type { FieldType } from "./fieldTypes.tsx";
import type { IconId, IconValue } from "./iconTypes";

declare const __CAMOX_ICON_IDS__: readonly string[];

/* -------------------------------------------------------------------------------------------------
 * toMarkdown builder API
 * -----------------------------------------------------------------------------------------------*/

export class FieldToken {
  constructor(public readonly fieldName: string) {}
  toString(): string {
    return `{{${this.fieldName}}}`;
  }
}

export type SettingsScope = "block" | "item";

/**
 * Serializable conditional block produced by the settings proxy. Emits Handlebars-style
 * `{{#if ...}}...{{/if}}` syntax wrapping each child line, tagged with its scope so the
 * server-side resolver knows whether to read from `settings` or `itemSettings`.
 */
export class Conditional {
  constructor(
    public readonly scope: SettingsScope,
    public readonly settingName: string,
    public readonly enumValue: string | null,
    public readonly children: ReadonlyArray<string | FieldToken | Conditional>,
  ) {}

  get openTag(): string {
    const root = this.scope === "block" ? "settings" : "itemSettings";
    if (this.enumValue === null) return `{{#if ${root}.${this.settingName}}}`;
    return `{{#if (eq ${root}.${this.settingName} "${this.enumValue}")}}`;
  }

  get closeTag(): string {
    return "{{/if}}";
  }
}

export type ConditionalChild = string | FieldToken | Conditional;
export type ConditionalLines = ConditionalChild | ReadonlyArray<ConditionalChild>;

export type ContentProxy<TShape extends Record<string, TSchema>> = {
  [K in keyof TShape & string]: string & FieldToken;
};

/**
 * Callable shape for one entry on the settings proxy. Booleans take a single `lines`
 * argument; enums take `(value, lines)`. Settings of other shapes are disallowed — they
 * don't make sense as conditions.
 */
type SettingCallable<T extends TSchema> =
  Static<T> extends boolean
    ? (lines: ConditionalLines) => Conditional
    : Static<T> extends string
      ? (value: Static<T>, lines: ConditionalLines) => Conditional
      : never;

export type SettingsProxy<TShape extends Record<string, TSchema>> = {
  [K in keyof TShape & string]: SettingCallable<TShape[K]>;
};

export type ToMarkdownBuilder<
  TContent extends Record<string, TSchema>,
  TSettings extends Record<string, TSchema> = Record<string, never>,
> = (
  c: ContentProxy<TContent>,
  s: SettingsProxy<TSettings>,
) => ReadonlyArray<string | FieldToken | Conditional>;

function createContentProxy<TShape extends Record<string, TSchema>>(): ContentProxy<TShape> {
  return new Proxy({} as ContentProxy<TShape>, {
    get(_target, prop) {
      if (typeof prop !== "string") return undefined;
      return new FieldToken(prop);
    },
  });
}

function createSettingsProxy<TShape extends Record<string, TSchema>>(
  settingsShape: TShape | undefined,
  scope: SettingsScope,
): SettingsProxy<TShape> {
  return new Proxy({} as SettingsProxy<TShape>, {
    get(_target, prop) {
      if (typeof prop !== "string") return undefined;
      const schema = settingsShape?.[prop] as { fieldType?: string } | undefined;
      const fieldType = schema?.fieldType;

      if (fieldType === "Boolean") {
        return (lines: ConditionalLines) =>
          new Conditional(scope, prop, null, Array.isArray(lines) ? lines : [lines]);
      }
      if (fieldType === "Enum") {
        return (value: string, lines: ConditionalLines) =>
          new Conditional(scope, prop, value, Array.isArray(lines) ? lines : [lines]);
      }
      throw new Error(
        `toMarkdown settings proxy: "${prop}" is not a Boolean or Enum setting on this ${scope}.`,
      );
    },
  }) as SettingsProxy<TShape>;
}

/** Flatten a `Conditional`'s children into wrapped lines, recursing into nested Conditionals. */
function serializeConditional(cond: Conditional): string[] {
  const out: string[] = [];
  for (const child of cond.children) {
    if (child instanceof Conditional) {
      for (const nested of serializeConditional(child)) {
        out.push(`${cond.openTag}${nested}${cond.closeTag}`);
      }
    } else {
      out.push(`${cond.openTag}${String(child)}${cond.closeTag}`);
    }
  }
  return out;
}

export function resolveToMarkdown<
  TContent extends Record<string, TSchema>,
  TSettings extends Record<string, TSchema> = Record<string, never>,
>(
  builder: ToMarkdownBuilder<TContent, TSettings>,
  settingsShape: TSettings | undefined,
  scope: SettingsScope,
): string[] {
  const contentProxy = createContentProxy<TContent>();
  const settingsProxy = createSettingsProxy<TSettings>(settingsShape, scope);
  const entries = builder(contentProxy, settingsProxy);

  const out: string[] = [];
  for (const entry of entries) {
    if (entry instanceof Conditional) {
      out.push(...serializeConditional(entry));
    } else {
      out.push(entry instanceof FieldToken ? entry.toString() : String(entry));
    }
  }
  return out;
}

/* -------------------------------------------------------------------------------------------------
 * EmbedURL branded type
 * -----------------------------------------------------------------------------------------------*/

declare const EmbedURLBrand: unique symbol;
export type EmbedURL = string & { readonly [EmbedURLBrand]: true };

/* -------------------------------------------------------------------------------------------------
 * Repeater settings brand
 * Carries the per-item settings shape on the TArray schema at the type level only,
 * so createBlock can infer a typed `item.useSetting` signature without runtime cost.
 * -----------------------------------------------------------------------------------------------*/

export declare const ItemSettingsBrand: unique symbol;
export type WithItemSettings<S extends Record<string, TSchema>> = {
  readonly [ItemSettingsBrand]?: S;
};

/* -------------------------------------------------------------------------------------------------
 * LinkValue branded type
 * -----------------------------------------------------------------------------------------------*/

declare const LinkBrand: unique symbol;
export type LinkValue = ({ type: "external"; href: string } | { type: "page"; pageId: string }) & {
  text: string;
  newTab: boolean;
} & {
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
  size?: number;
  _fileId?: string;
} & { readonly __brand: "ImageValue" };

/* -------------------------------------------------------------------------------------------------
 * FileValue branded type
 * -----------------------------------------------------------------------------------------------*/

export type FileValue = {
  url: string;
  alt: string;
  filename: string;
  mimeType: string;
  size?: number;
  _fileId?: string;
} & { readonly __brand: "FileValue" };

/* -------------------------------------------------------------------------------------------------
 * Typebox wrapper used for content schemas
 * -----------------------------------------------------------------------------------------------*/

/* -------------------------------------------------------------------------------------------------
 * Image / File / ImageList / FileList type builders
 * -----------------------------------------------------------------------------------------------*/

function _imageSingle(options: { title?: string }): TUnsafe<ImageValue> {
  return TypeBoxType.Unsafe<ImageValue>({
    type: "object",
    properties: {
      url: { type: "string" },
      alt: { type: "string" },
      filename: { type: "string" },
      mimeType: { type: "string" },
    },
    accept: ["image/*"],
    default: {
      url: `https://placehold.co/1200x800/f4f4f5/a1a1aa.png?text=${options?.title || "image"}`,
      alt: "",
      filename: "placeholder.png",
      mimeType: "image/png",
    },
    title: options.title,
    fieldType: "Image" as const,
  });
}

function _imageList(options: {
  title?: string;
  defaultItems?: number;
}): TArray<TUnsafe<ImageValue>> {
  return TypeBoxType.Array(_imageSingle({ title: options.title }), {
    minItems: 0,
    maxItems: 100,
    default: [],
    defaultItems: options.defaultItems ?? 0,
    title: options.title,
    fieldType: "ImageList" as const,
  });
}

function _fileSingle(options: { accept: string[]; title?: string }): TUnsafe<FileValue> {
  return TypeBoxType.Unsafe<FileValue>({
    type: "object",
    properties: {
      url: { type: "string" },
      alt: { type: "string" },
      filename: { type: "string" },
      mimeType: { type: "string" },
    },
    accept: options.accept,
    default: {
      url: "https://placehold.co/file-placeholder",
      alt: "",
      filename: "placeholder",
      mimeType: "application/octet-stream",
    },
    title: options.title,
    fieldType: "File" as const,
  });
}

function _fileList(options: {
  accept: string[];
  title?: string;
  defaultItems?: number;
}): TArray<TUnsafe<FileValue>> {
  return TypeBoxType.Array(_fileSingle({ accept: options.accept, title: options.title }), {
    minItems: 0,
    maxItems: 100,
    default: [],
    defaultItems: options.defaultItems ?? 0,
    title: options.title,
    fieldType: "FileList" as const,
  });
}

/**
 * Type builders for createBlock content schemas.
 * All fields must have default values.
 */
export const Type = {
  Icon: (options: { default: IconId; title?: string }) => {
    const ids = typeof __CAMOX_ICON_IDS__ === "undefined" ? [] : __CAMOX_ICON_IDS__;
    if (!ids.includes(options.default))
      throw new Error(
        `Invalid icon default "${String(options.default)}". Configure icons in camox() first.`,
      );
    return TypeBoxType.Unsafe<IconValue>({
      type: "string",
      fieldType: "Icon",
      enum: [...ids],
      default: options.default,
      title: options.title,
    });
  },
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
    return TypeBoxType.Unsafe<string>({
      type: "string",
      ...options,
      default: options.default,
      fieldType: "String" as const,
    });
  },

  /**
   * Creates a repeatable array of object items.
   * The default array is auto-generated based on minItems.
   *
   * Items may also declare per-item `settings` (Enum/Boolean only) — not
   * inline-editable; they appear in the sidebar when the item is selected,
   * similar to block-level settings.
   *
   * @example
   * Type.Repeater({
   *   content: {
   *     title: Type.String({ default: 'Item' }),
   *     description: Type.String({ default: 'Description' }),
   *   },
   *   settings: {
   *     highlighted: Type.Boolean({ default: false, title: 'Highlighted' }),
   *   },
   *   minItems: 1,
   *   maxItems: 10,
   *   title: 'Items',
   *   toMarkdown: (c) => [`### ${c.title}`, c.description],
   * })
   */
  Repeater: <
    T extends Record<string, TSchema>,
    S extends Record<string, TSchema> = Record<string, never>,
  >(options: {
    content: T;
    settings?: S;
    minItems: number;
    maxItems: number;
    title?: string;
    toMarkdown: ToMarkdownBuilder<T, S>;
  }) => {
    if (options.minItems < 1) {
      throw new Error("Repeater requires minItems to be at least 1");
    }

    const objectSchema = TypeBoxType.Object(options.content);

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

    const settingsTypeboxSchema = options.settings ? TypeBoxType.Object(options.settings) : null;

    const itemSettingsSchema = settingsTypeboxSchema
      ? {
          type: "object" as const,
          properties: settingsTypeboxSchema.properties,
          required: Object.keys(options.settings!),
        }
      : undefined;

    const defaultItemSettings: Record<string, unknown> = {};
    if (settingsTypeboxSchema) {
      for (const [key, prop] of Object.entries(settingsTypeboxSchema.properties)) {
        if ("default" in prop) {
          defaultItemSettings[key] = (prop as { default: unknown }).default;
        }
      }
    }

    return TypeBoxType.Array(objectSchema, {
      minItems: options.minItems,
      maxItems: options.maxItems,
      default: defaultArray,
      title: options.title,
      fieldType: "Repeater" as const,
      toMarkdown: resolveToMarkdown<T, S>(options.toMarkdown, options.settings, "item"),
      itemSettingsSchema,
      defaultItemSettings: settingsTypeboxSchema ? defaultItemSettings : undefined,
    }) as TArray<TObject<T>> & WithItemSettings<S>;
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
  Enum: <const O extends Record<string, string>>(options: {
    default: keyof O & string;
    options: O;
    title?: string;
  }) => {
    const enumValues = Object.keys(options.options);
    return TypeBoxType.Unsafe<keyof O & string>({
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
  Link: (options: { default: { text: string; href: string; newTab: boolean }; title?: string }) => {
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
   * Creates an image asset field.
   *
   * @example
   * Type.Image({ title: 'Hero' })
   */
  Image: (options: { title?: string } = {}) => _imageSingle(options),

  /**
   * Creates a file asset field.
   *
   * @example
   * Type.File({ accept: ['application/pdf'], title: 'Datasheet' })
   */
  File: (options: { accept: string[]; title?: string }) => _fileSingle(options),

  /**
   * Creates an array of image assets.
   *
   * @example
   * Type.ImageList({ title: 'Gallery', defaultItems: 3 })
   */
  ImageList: (options: { title?: string; defaultItems?: number } = {}) => _imageList(options),

  /**
   * Creates an array of file assets.
   *
   * @example
   * Type.FileList({ accept: ['application/pdf'], title: 'Attachments' })
   */
  FileList: (options: { accept: string[]; title?: string; defaultItems?: number }) =>
    _fileList(options),
} satisfies Record<FieldType, unknown>;
