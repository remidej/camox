import {
  Type as TypeBoxType,
  type TSchema,
  type Static,
  type TUnsafe,
  type TArray,
  type TObject,
  type TBoolean,
} from "@sinclair/typebox";

import type { Collection } from "../createCollection";
import type { IconId, IconValue } from "./iconTypes";

export declare const ReferenceContentBrand: unique symbol;
export type ReferenceSchema<T extends Record<string, TSchema>> = TUnsafe<string | null> & {
  readonly [ReferenceContentBrand]: T;
  fieldType: "Reference";
};
export type ReferenceListSchema<T extends Record<string, TSchema>> = TUnsafe<string[]> & {
  readonly [ReferenceContentBrand]: T;
  fieldType: "ReferenceList";
};

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
  [K in keyof TShape & string]: TShape[K] extends ReferenceSchema<infer T>
    ? ContentProxy<T>
    : string & FieldToken;
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

function createContentProxy<TShape extends Record<string, TSchema>>(
  shape?: TShape,
  prefix = "",
): ContentProxy<TShape> {
  return new Proxy({} as ContentProxy<TShape>, {
    get(_target, prop) {
      if (typeof prop !== "string") return undefined;
      const path = prefix ? `${prefix}.${prop}` : prop;
      const field = shape?.[prop];
      if (field?.fieldType === "Reference") {
        return createContentProxy(field.referenceSchema.properties, path);
      }
      return new FieldToken(path);
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
  contentShape?: TContent,
): string[] {
  const contentProxy = createContentProxy<TContent>(contentShape);
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

// Symbols survive local schema/default copies, but never enter persisted JSON or AI schemas.
const IMAGE_PLACEHOLDER = Symbol("camox.imagePlaceholder");

export function isImagePlaceholder(value: ImageValue): boolean {
  return typeof Reflect.get(value, IMAGE_PLACEHOLDER) === "string" && !value._fileId;
}

export function getImagePlaceholderTitle(value: ImageValue): string {
  return Reflect.get(value, IMAGE_PLACEHOLDER) as string;
}

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
      [IMAGE_PLACEHOLDER]: options.title || "image",
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

/* -------------------------------------------------------------------------------------------------
 * Field builders
 * Each definition context receives only the field kinds it accepts, so a misplaced field is a
 * missing property on the builder rather than a schema mismatch.
 * -----------------------------------------------------------------------------------------------*/

export type StringField = TUnsafe<string> & { fieldType: "String" };
export type LinkField = TUnsafe<LinkValue>;
export type ImageField = TUnsafe<ImageValue>;
export type ImageListField = TArray<TUnsafe<ImageValue>>;
export type FileField = TUnsafe<FileValue>;
export type FileListField = TArray<TUnsafe<FileValue>>;
export type EmbedField = TUnsafe<EmbedURL>;
export type IconField = TUnsafe<IconValue>;
export type RepeaterField<
  T extends Record<string, TSchema>,
  S extends Record<string, TSchema>,
> = TArray<TObject<T>> & WithItemSettings<S>;
export type EnumSetting<O extends Record<string, string>> = TUnsafe<keyof O & string> & {
  fieldType: "Enum";
};
export type BooleanSetting = TBoolean & { fieldType: "Boolean" };

type StringOptions = {
  title?: string;
  maxLength?: number;
  minLength?: number;
  pattern?: string;
};

/**
 * Builds the fields of a block or repeatable item's content.
 * `enum` and `boolean` are not content: declare them in `settings` instead.
 */
export interface ContentFieldBuilder {
  /**
   * An inline-editable text field.
   *
   * @example
   * field.string({ default: "Hello", maxLength: 100, title: "Title" })
   */
  string: (options: StringOptions & { default: string }) => StringField;
  /**
   * A link with text, a target (external URL or internal page) and a new-tab flag.
   *
   * @example
   * field.link({ default: { text: "Learn more", href: "/", newTab: false }, title: "CTA" })
   */
  link: (options: {
    default: { text: string; href: string; newTab: boolean };
    title?: string;
  }) => LinkField;
  /**
   * An image asset.
   *
   * @example
   * field.image({ title: "Hero" })
   */
  image: (options?: { title?: string }) => ImageField;
  /**
   * A list of image assets.
   *
   * @example
   * field.imageList({ title: "Gallery", defaultItems: 3 })
   */
  imageList: (options?: { title?: string; defaultItems?: number }) => ImageListField;
  /**
   * A file asset.
   *
   * @example
   * field.file({ accept: ["application/pdf"], title: "Datasheet" })
   */
  file: (options: { accept: string[]; title?: string }) => FileField;
  /**
   * A list of file assets.
   *
   * @example
   * field.fileList({ accept: ["application/pdf"], title: "Attachments" })
   */
  fileList: (options: { accept: string[]; title?: string; defaultItems?: number }) => FileListField;
  /**
   * A URL that must match `pattern`, rendered as an embed.
   *
   * @example
   * field.embed({
   *   pattern: "https:\\/\\/(www\\.)?youtube\\.com\\/watch\\?v=.+",
   *   default: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
   *   title: "YouTube URL",
   * })
   */
  embed: (options: { pattern: string; default: string; title?: string }) => EmbedField;
  /**
   * An icon from the set configured in `camox()`.
   *
   * @example
   * field.icon({ default: "lucide:star", title: "Icon" })
   */
  icon: (options: { default: IconId; title?: string }) => IconField;
  /**
   * Selects a record of `collection` by identity; its content is resolved independently.
   *
   * @example
   * field.reference(customers, { title: "Customer" })
   */
  reference: <T extends Record<string, TSchema>>(
    collection: Collection<T>,
    options?: { title?: string; required?: boolean },
  ) => ReferenceSchema<T>;
  /**
   * An ordered list of distinct records of `collection`; each resolves independently.
   * An empty list is always valid, so there is no `required` or `minItems`.
   * `toMarkdown` renders each linked record (one list item per record, in stored order);
   * the block's own `toMarkdown` includes the whole list through its token.
   *
   * @example
   * field.referenceList(customers, { maxItems: 6, toMarkdown: (c) => [c.name] })
   */
  referenceList: <T extends Record<string, TSchema>>(
    collection: Collection<T>,
    options?: {
      title?: string;
      description?: string;
      maxItems?: number;
      toMarkdown?: ToMarkdownBuilder<T>;
    },
  ) => ReferenceListSchema<T>;
  /**
   * Repeatable items, each with its own content and optional settings. Repeaters may nest.
   * Item settings are edited in the sidebar when the item is selected.
   *
   * @example
   * field.repeater({
   *   content: (field) => ({
   *     title: field.string({ default: "Item" }),
   *     description: field.string({ default: "Description" }),
   *   }),
   *   settings: (setting) => ({
   *     highlighted: setting.boolean({ default: false, title: "Highlighted" }),
   *   }),
   *   minItems: 1,
   *   maxItems: 10,
   *   title: "Items",
   *   toMarkdown: (c, s) => [`### ${c.title}`, s.highlighted(c.description)],
   * })
   */
  repeater: <
    T extends Record<string, TSchema>,
    S extends Record<string, TSchema> = Record<string, never>,
  >(options: {
    content: (field: ContentFieldBuilder) => T;
    settings?: (setting: SettingBuilder) => S;
    minItems: number;
    maxItems: number;
    title?: string;
    toMarkdown: ToMarkdownBuilder<T, S>;
  }) => RepeaterField<T, S>;
}

/**
 * Builds the settings of a block or repeatable item: presentation options edited in the
 * sidebar, never inline. Only `enum` and `boolean` are settings.
 */
export interface SettingBuilder {
  /**
   * One of a fixed set of options; keys are stored, values are editor labels.
   *
   * @example
   * setting.enum({ default: "left", options: { left: "Left", right: "Right" }, title: "Alignment" })
   */
  enum: <const O extends Record<string, string>>(options: {
    default: keyof O & string;
    options: O;
    title?: string;
  }) => EnumSetting<O>;
  /**
   * A toggle.
   *
   * @example
   * setting.boolean({ default: false, title: "Show background" })
   */
  boolean: (options: { default: boolean; title?: string }) => BooleanSetting;
}

/**
 * Builds the fields of a collection record. Records are created through an authoring form, so
 * `string` needs no default. Collections have no settings: `enum` and `boolean` are content here.
 */
export interface CollectionFieldBuilder extends Pick<
  ContentFieldBuilder,
  "image" | "imageList" | "file" | "fileList" | "embed" | "referenceList"
> {
  /**
   * Selects a record of another collection by identity, e.g. an article's author. Never
   * required: an unpublished record resolves empty on the live site.
   *
   * @example
   * field.reference(authors, { title: "Author" })
   */
  reference: <T extends Record<string, TSchema>>(
    collection: Collection<T>,
    options?: { title?: string },
  ) => ReferenceSchema<T>;
  /**
   * A text field.
   *
   * @example
   * field.string({ minLength: 1, title: "Name" })
   */
  string: (options?: StringOptions & { default?: string }) => StringField;
  /**
   * One of a fixed set of options; keys are stored, values are editor labels.
   *
   * @example
   * field.enum({ default: "draft", options: { draft: "Draft", final: "Final" } })
   */
  enum: SettingBuilder["enum"];
  /**
   * A toggle.
   *
   * @example
   * field.boolean({ default: false, title: "Featured" })
   */
  boolean: SettingBuilder["boolean"];
}

const settingKinds = new Set<string>(["Enum", "Boolean"]);

/** Builders are typed per context; this guards callers that bypass the types. */
export function assertFieldKinds(
  shape: Record<string, TSchema>,
  context: "content" | "settings",
  owner: string,
) {
  for (const [key, field] of Object.entries(shape)) {
    const isSetting = settingKinds.has(field.fieldType);
    if (context === "settings" && !isSetting) {
      throw new Error(`${owner} setting "${key}" must be an enum or a boolean`);
    }
    if (context === "content" && isSetting) {
      throw new Error(`${owner} field "${key}": ${field.fieldType} is a setting, not content`);
    }
  }
}

function collectSchemaDefaults(properties: Record<string, TSchema>) {
  const defaults: Record<string, unknown> = {};
  for (const [key, prop] of Object.entries(properties)) {
    if ("default" in prop) defaults[key] = prop.default;
  }
  return defaults;
}

const enumSetting: SettingBuilder["enum"] = (options) =>
  TypeBoxType.Unsafe({
    type: "string",
    enum: Object.keys(options.options),
    default: options.default,
    title: options.title,
    enumLabels: options.options,
    fieldType: "Enum" as const,
  }) as EnumSetting<typeof options.options>;

const booleanSetting: SettingBuilder["boolean"] = (options) =>
  TypeBoxType.Boolean({
    default: options.default,
    title: options.title,
    fieldType: "Boolean" as const,
  }) as BooleanSetting;

export const settingBuilder: SettingBuilder = {
  enum: enumSetting,
  boolean: booleanSetting,
};

export const contentFieldBuilder: ContentFieldBuilder = {
  string: (options) =>
    TypeBoxType.Unsafe<string>({
      type: "string",
      ...options,
      fieldType: "String" as const,
    }) as StringField,
  link: (options) =>
    TypeBoxType.Unsafe<LinkValue>({
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
    }),
  image: (options = {}) => _imageSingle(options),
  imageList: (options = {}) => _imageList(options),
  file: (options) => _fileSingle(options),
  fileList: (options) => _fileList(options),
  embed: (options) => {
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
  icon: (options) => {
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
  reference: <T extends Record<string, TSchema>>(
    collection: Collection<T>,
    options: { title?: string; required?: boolean } = {},
  ) =>
    TypeBoxType.Unsafe<string | null>({
      anyOf: [{ type: "string", format: "uuid" }, { type: "null" }],
      fieldType: "Reference",
      collectionId: collection._internal.id,
      required: options.required ?? false,
      title: options.title ?? collection._internal.title,
      default: null,
      // Used by the typed child scope, not a copy of a record's content.
      referenceSchema: collection._internal.contentSchema,
      labelField: collection._internal.label,
    }) as ReferenceSchema<T>,
  referenceList: <T extends Record<string, TSchema>>(
    collection: Collection<T>,
    options: {
      title?: string;
      description?: string;
      maxItems?: number;
      toMarkdown?: ToMarkdownBuilder<T>;
    } = {},
  ) =>
    TypeBoxType.Unsafe<string[]>({
      type: "array",
      items: { type: "string", format: "uuid" },
      fieldType: "ReferenceList",
      collectionId: collection._internal.id,
      title: options.title ?? collection._internal.title,
      ...(options.description === undefined ? {} : { description: options.description }),
      ...(options.maxItems === undefined ? {} : { maxItems: options.maxItems }),
      ...(options.toMarkdown === undefined
        ? {}
        : {
            toMarkdown: resolveToMarkdown<T>(
              options.toMarkdown,
              undefined,
              "item",
              collection._internal.contentSchema.properties as T,
            ),
          }),
      default: [],
      // Used by the typed child scope, not a copy of a record's content.
      referenceSchema: collection._internal.contentSchema,
      labelField: collection._internal.label,
    }) as ReferenceListSchema<T>,
  repeater: <
    T extends Record<string, TSchema>,
    S extends Record<string, TSchema> = Record<string, never>,
  >(options: {
    content: (field: ContentFieldBuilder) => T;
    settings?: (setting: SettingBuilder) => S;
    minItems: number;
    maxItems: number;
    title?: string;
    toMarkdown: ToMarkdownBuilder<T, S>;
  }) => {
    if (options.minItems < 1) {
      throw new Error("Repeater requires minItems to be at least 1");
    }

    const content = options.content(contentFieldBuilder);
    const settings = options.settings?.(settingBuilder);
    const owner = `Repeater${options.title ? ` "${options.title}"` : ""}`;
    assertFieldKinds(content, "content", owner);
    if (settings) assertFieldKinds(settings, "settings", owner);

    const objectSchema = TypeBoxType.Object(content);
    // Value.Create doesn't support Unsafe types, so defaults are read off each field.
    const defaultItem = collectSchemaDefaults(objectSchema.properties);
    const defaultArray = Array(options.minItems)
      .fill(null)
      .map(() => ({ ...defaultItem }));

    const settingsObjectSchema = settings ? TypeBoxType.Object(settings) : null;
    const itemSettingsSchema = settingsObjectSchema
      ? {
          type: "object" as const,
          properties: settingsObjectSchema.properties,
          required: Object.keys(settingsObjectSchema.properties),
        }
      : undefined;

    return TypeBoxType.Array(objectSchema, {
      minItems: options.minItems,
      maxItems: options.maxItems,
      default: defaultArray,
      title: options.title,
      fieldType: "Repeater" as const,
      toMarkdown: resolveToMarkdown<T, S>(options.toMarkdown, settings, "item", content),
      itemSettingsSchema,
      defaultItemSettings: settingsObjectSchema
        ? collectSchemaDefaults(settingsObjectSchema.properties)
        : undefined,
    }) as RepeaterField<T, S>;
  },
};

export const collectionFieldBuilder: CollectionFieldBuilder = {
  string: (options = {}) =>
    TypeBoxType.Unsafe<string>({
      type: "string",
      ...options,
      fieldType: "String" as const,
    }) as StringField,
  enum: enumSetting,
  boolean: booleanSetting,
  image: contentFieldBuilder.image,
  imageList: contentFieldBuilder.imageList,
  file: contentFieldBuilder.file,
  fileList: contentFieldBuilder.fileList,
  embed: contentFieldBuilder.embed,
  reference: (collection, options = {}) =>
    contentFieldBuilder.reference(collection, { title: options.title }),
  referenceList: contentFieldBuilder.referenceList,
};

/** Runs a block's builders so the rest of its definition works with plain schemas. */
export function resolveBlockFields<
  TContent extends Record<string, TSchema>,
  TSettings extends Record<string, TSchema>,
>(options: {
  id: string;
  content: (field: ContentFieldBuilder) => TContent;
  settings?: (setting: SettingBuilder) => TSettings;
}): { content: TContent; settings: TSettings | undefined } {
  const content = options.content(contentFieldBuilder);
  const settings = options.settings?.(settingBuilder);
  const owner = `Block "${options.id}"`;
  assertFieldKinds(content, "content", owner);
  if (settings) assertFieldKinds(settings, "settings", owner);
  return { content, settings };
}
