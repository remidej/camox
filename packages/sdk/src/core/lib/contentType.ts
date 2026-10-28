import {
  referenceQueryProblem,
  type SettingCondition as ApiSettingCondition,
  type SystemOrderKey,
} from "@camox/api-contract";
import { uuidv7JsonSchema } from "@camox/api-contract/ids";
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
import type { BlockStructuredData, KnownNodesOnly, RepeatedNodes } from "../structuredData";
import { attachArtifactData } from "./artifactData";
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

/* -------------------------------------------------------------------------------------------------
 * Query-backed reference lists
 * -----------------------------------------------------------------------------------------------*/

/** A collection's content field named `key`, if it has one. */
export function collectionField(
  collection: { contentSchema: { properties: Record<string, TSchema> } } | undefined,
  key: string,
): TSchema | undefined {
  const properties = collection?.contentSchema.properties;
  return properties && Object.hasOwn(properties, key) ? properties[key] : undefined;
}

/** The keys a query can order a collection's records by: its text fields and system metadata. */
export type OrderableKeys<T extends Record<string, TSchema>> =
  | {
      [K in keyof T & string]: T[K] extends { fieldType: "String" } ? K : never;
    }[keyof T & string]
  | SystemOrderKey;

/** A single-key ordering: `{ title: "asc" }`. */
export type QueryOrderBy<K extends string> = {
  [P in K]: { [Q in P]: "asc" | "desc" } & { [Q in Exclude<K, P>]?: never };
}[K];

type Range<N extends number, Acc extends number[] = []> = Acc["length"] extends N
  ? Acc[number]
  : Range<N, [...Acc, Acc["length"]]>;
/** 1 to 100: literal limits outside it are rejected; computed `number` limits are checked on sync. */
type QueryLimit = Exclude<Range<101>, 0>;
export type ValidQueryLimit<L extends number> = number extends L
  ? number
  : L extends QueryLimit
    ? L
    : never;

/**
 * Defines a query-backed list's membership and order in code: optionally one ordering key and a
 * limit (at most, and by default, 100 records). Live pages list published records ordered by
 * their published content; the preview lists drafts too. Ties break by record id.
 */
export type ReferenceQuery<T extends Record<string, TSchema>, L extends number = number> = {
  orderBy?: QueryOrderBy<OrderableKeys<T>>;
  limit?: L & ValidQueryLimit<L>;
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

/** What a block's or repeatable item's templates receive: proxies of its content and settings. */
export interface TemplateContext<
  TContent extends Record<string, TSchema>,
  TSettings extends Record<string, TSchema> = Record<string, never>,
> {
  content: ContentProxy<TContent>;
  settings: SettingsProxy<TSettings>;
}

/** Builds a Markdown template from `{ content, settings }`. */
export type ToMarkdownBuilder<
  TContent extends Record<string, TSchema>,
  TSettings extends Record<string, TSchema> = Record<string, never>,
> = (
  context: TemplateContext<TContent, TSettings>,
) => ReadonlyArray<string | FieldToken | Conditional>;

/** Reads each field as its token. `TProxy` is how the template reads the fields. */
function createContentProxy<TProxy extends object>(
  shape?: Record<string, TSchema>,
  prefix = "",
): TProxy {
  return new Proxy({} as TProxy, {
    get(_target, prop) {
      if (typeof prop !== "string") return undefined;
      const path = prefix ? `${prefix}.${prop}` : prop;
      const field = shape?.[prop];
      if (field?.fieldType === "Reference") {
        return referenceToken(field.referenceSchema.properties, path);
      }
      return new FieldToken(path);
    },
  });
}

/**
 * A reference field's token, which names the reference itself, as Structured Data templates
 * link records by it, and whose properties are the tokens of the record's fields.
 */
function referenceToken(shape: Record<string, TSchema> | undefined, path: string) {
  const fields = createContentProxy<Record<string, unknown>>(shape, path);
  return new Proxy(new FieldToken(path), {
    get(target, prop) {
      // `in` found it on the token: one of its own members.
      if (typeof prop !== "string" || prop in target) return target[prop as keyof FieldToken];
      return fields[prop];
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
  const content = createContentProxy<ContentProxy<TContent>>(contentShape);
  const settings = createSettingsProxy<TSettings>(settingsShape, scope);
  const entries = builder({ content, settings });

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

/** A collection's String fields as field tokens: what its record templates can name. */
export type RecordTextProxy<TShape extends Record<string, TSchema>> = {
  [K in keyof TShape & string as TShape[K] extends { fieldType: "String" } ? K : never]: string &
    FieldToken;
};

/** What a collection's `toTitle` and `toDescription` receive: the record's String fields. */
export interface RecordTemplateContext<TShape extends Record<string, TSchema>> {
  content: RecordTextProxy<TShape>;
}

/**
 * Runs a collection's record template, such as `toTitle`, into the token template the API fills
 * with each record's plain text. Null when it returns nothing.
 */
export function resolveRecordTemplate<TShape extends Record<string, TSchema>>(
  template: (context: RecordTemplateContext<TShape>) => string | undefined,
  contentShape: TShape,
): string | null {
  const content = createContentProxy<RecordTextProxy<TShape>>(contentShape);
  const result = template({ content });
  return result === undefined || result === null || String(result) === "" ? null : String(result);
}

/**
 * Builds a title template from `{ content, settings }`: one line naming a block or repeatable item
 * until it has a Summary, such as its headline. The API evaluates it on default-locale content.
 */
export type ToTitleBuilder<
  TContent extends Record<string, TSchema>,
  TSettings extends Record<string, TSchema> = Record<string, never>,
> = (context: TemplateContext<TContent, TSettings>) => string | FieldToken;

/** The one-line title template a `toTitle` builder declares. */
export function resolveToTitle<
  TContent extends Record<string, TSchema>,
  TSettings extends Record<string, TSchema> = Record<string, never>,
>(
  builder: ToTitleBuilder<TContent, TSettings>,
  settingsShape: TSettings | undefined,
  scope: SettingsScope,
  contentShape?: TContent,
): string {
  const content = createContentProxy<ContentProxy<TContent>>(contentShape);
  const settings = createSettingsProxy<TSettings>(settingsShape, scope);
  return String(builder({ content, settings }));
}

/**
 * An image field's token in a Structured Data template, which the API evaluates into an
 * `ImageObject` with its absolute URL, dimensions and alt text.
 */
export type ImageToken = { "@type": "ImageObject"; url: string; contentUrl: string };

/**
 * A reference's token in a Structured Data template: a link to the record's node, which Camox
 * adds to the page's graph, or the record's title when its collection has no `toStructuredData`.
 */
export type RecordToken = { readonly "@id": string };

/**
 * What a field reads as in a Structured Data template. Text, files, links and embeds read as
 * strings, links and files as absolute URLs. References link their records' nodes, and their
 * fields read as the record's. Icons, artifacts and lists of files aren't Structured Data.
 */
type StructuredDataToken<T extends TSchema> =
  T extends ReferenceSchema<infer R>
    ? RecordToken & StructuredDataProxy<R>
    : T extends ReferenceListSchema<any>
      ? RecordToken[]
      : T extends { fieldType: "Artifact" }
        ? never
        : T extends TArray<TObject<any>>
          ? RepeatedNodes
          : T extends TArray<any>
            ? never
            : Static<T> extends IconValue
              ? never
              : Static<T> extends ImageValue
                ? ImageToken
                : Static<T> extends string | LinkValue | FileValue
                  ? string & FieldToken
                  : never;

/** A block's or repeatable item's fields as a Structured Data template reads them. */
export type StructuredDataProxy<TShape extends Record<string, TSchema>> = {
  [
    K in keyof TShape & string as [StructuredDataToken<TShape[K]>] extends [never] ? never : K
  ]: StructuredDataToken<TShape[K]>;
};

/**
 * One setting in a Structured Data template: shows a part of the template only while it holds,
 * typed as the part it shows. A Boolean takes the part; an Enum takes the option it must equal,
 * then the part. Settings of other shapes aren't conditions.
 */
type StructuredDataSettingCallable<T extends TSchema> =
  Static<T> extends boolean
    ? <const V>(value: V) => V
    : Static<T> extends string
      ? <const V>(equals: Static<T>, value: V) => V
      : never;

/** A block's or repeatable item's settings, as its Structured Data template reads them. */
export type StructuredDataSettingsProxy<TShape extends Record<string, TSchema>> = {
  [K in keyof TShape & string]: StructuredDataSettingCallable<TShape[K]>;
};

/** A part of a Structured Data template shown only while a setting holds. */
class SettingCondition {
  constructor(
    public readonly scope: SettingsScope,
    public readonly settingName: string,
    public readonly equals: string | null,
    public readonly show: unknown,
  ) {}
}

function createStructuredDataSettingsProxy<TShape extends Record<string, TSchema>>(
  settingsShape: TShape | undefined,
  scope: SettingsScope,
): StructuredDataSettingsProxy<TShape> {
  return new Proxy({} as StructuredDataSettingsProxy<TShape>, {
    get(_target, prop) {
      if (typeof prop !== "string") return undefined;
      const fieldType = (settingsShape?.[prop] as { fieldType?: string } | undefined)?.fieldType;
      if (fieldType === "Boolean") {
        return (value: unknown) => new SettingCondition(scope, prop, null, value);
      }
      if (fieldType === "Enum") {
        return (equals: string, value: unknown) => new SettingCondition(scope, prop, equals, value);
      }
      throw new Error(
        `toStructuredData settings proxy: "${prop}" is not a Boolean or Enum setting on this ${scope}.`,
      );
    },
  });
}

/** What a block's or repeatable item's `toStructuredData` receives. */
export interface StructuredDataContext<
  TContent extends Record<string, TSchema>,
  TSettings extends Record<string, TSchema> = Record<string, never>,
> {
  content: StructuredDataProxy<TContent>;
  settings: StructuredDataSettingsProxy<TSettings>;
}

/**
 * Builds a block's or repeatable item's Structured Data template from `{ content, settings }`:
 * the nodes it shows. A repeater's token places its items' nodes. The API evaluates the
 * template on each page's content, and Camox links each node to its page.
 */
export type ToStructuredDataBuilder<
  TContent extends Record<string, TSchema>,
  TSettings extends Record<string, TSchema>,
  Nodes extends BlockStructuredData,
> = (context: StructuredDataContext<TContent, TSettings>) => Nodes & KnownNodesOnly<Nodes>;

/** A template's value as the Definition Set syncs it: JSON, with tokens as `{{field}}`. */
function serializeTemplate(value: unknown): unknown {
  if (value instanceof FieldToken) return value.toString();
  if (value instanceof SettingCondition) {
    const condition: ApiSettingCondition = {
      "@camox": "if",
      setting: `${value.scope === "block" ? "settings" : "itemSettings"}.${value.settingName}`,
      ...(value.equals !== null && { equals: value.equals }),
      show: serializeTemplate(value.show),
    };
    return condition;
  }
  if (Array.isArray(value)) return value.map(serializeTemplate);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).flatMap(([key, entry]) =>
        entry === undefined ? [] : [[key, serializeTemplate(entry)]],
      ),
    );
  }
  return value;
}

/** The Structured Data template a `toStructuredData` builder declares. */
export function resolveToStructuredData<
  TContent extends Record<string, TSchema>,
  TSettings extends Record<string, TSchema>,
>(
  builder: (context: StructuredDataContext<TContent, TSettings>) => unknown,
  settingsShape: TSettings | undefined,
  scope: SettingsScope,
  contentShape?: TContent,
): unknown {
  const content = createContentProxy<StructuredDataProxy<TContent>>(contentShape);
  const settings = createStructuredDataSettingsProxy<TSettings>(settingsShape, scope);
  return serializeTemplate(builder({ content, settings }));
}

/** What a collection's `toStructuredData` receives: the record's fields as tokens. */
export interface RecordStructuredDataContext<TShape extends Record<string, TSchema>> {
  content: StructuredDataProxy<TShape>;
}

/** The Structured Data template of each record of a collection, as its builder declares it. */
export function resolveRecordStructuredData<TShape extends Record<string, TSchema>>(
  builder: (context: RecordStructuredDataContext<TShape>) => unknown,
  contentShape: TShape,
): Record<string, unknown> {
  const content = createContentProxy<StructuredDataProxy<TShape>>(contentShape);
  return serializeTemplate(builder({ content })) as Record<string, unknown>;
}

/* -------------------------------------------------------------------------------------------------
 * EmbedURL branded type
 * -----------------------------------------------------------------------------------------------*/

declare const EmbedURLBrand: unique symbol;
export type EmbedURL = string & { readonly [EmbedURLBrand]: true };

/* -------------------------------------------------------------------------------------------------
 * ArtifactSource branded type
 * Keeps artifact fields out of the string-field primitives such as `block.Field`.
 * -----------------------------------------------------------------------------------------------*/

declare const ArtifactSourceBrand: unique symbol;
export type ArtifactSource = string & { readonly [ArtifactSourceBrand]: true };

/** The longest artifact source content writes accept (256 KB). */
export const ARTIFACT_MAX_LENGTH = 256 * 1024;

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

/** An image, which a field's default marks as a placeholder with its title. */
type MaybePlaceholderImage = ImageValue & { readonly [IMAGE_PLACEHOLDER]?: string };

export function isImagePlaceholder(value: MaybePlaceholderImage): boolean {
  return typeof value[IMAGE_PLACEHOLDER] === "string" && !value._fileId;
}

export function getImagePlaceholderTitle(value: MaybePlaceholderImage): string | undefined {
  return value[IMAGE_PLACEHOLDER];
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

function _imageSingle(options: { title?: string; required?: boolean }): TUnsafe<ImageValue> {
  return TypeBoxType.Unsafe<ImageValue>({
    type: "object",
    properties: {
      url: { type: "string" },
      alt: { type: "string" },
      filename: { type: "string" },
      mimeType: { type: "string" },
    },
    accept: ["image/*"],
    required: options.required ?? false,
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

function _fileSingle(options: {
  accept: string[];
  title?: string;
  required?: boolean;
}): TUnsafe<FileValue> {
  return TypeBoxType.Unsafe<FileValue>({
    type: "object",
    properties: {
      url: { type: "string" },
      alt: { type: "string" },
      filename: { type: "string" },
      mimeType: { type: "string" },
    },
    accept: options.accept,
    required: options.required ?? false,
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
declare const ArtifactDataBrand: unique symbol;
/** An artifact field; `D` carries the names of its Artifact Data at the type level only. */
export type ArtifactField<D extends string = string> = TUnsafe<ArtifactSource> & {
  fieldType: "Artifact";
  readonly [ArtifactDataBrand]?: D;
};
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
  image: (options?: { title?: string; required?: boolean }) => ImageField;
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
  file: (options: { accept: string[]; title?: string; required?: boolean }) => FileField;
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
   * A self-contained web page, usually written by an agent, rendered in a sandboxed frame.
   * `size: "fill"` fills a container whose size you control; `size: "content"` follows the
   * page's height. The source is optional: an empty artifact renders nothing on the website.
   *
   * @example
   * field.artifact({ size: "fill", title: "Hero visual" })
   */
  artifact: <const D extends string = never>(options: {
    size: "fill" | "content";
    /**
     * Sibling content fields and settings shared with the artifact as Artifact Data. Inside a
     * repeater, the siblings are the item's own fields and settings.
     */
    data?: readonly D[];
    default?: string;
    title?: string;
  }) => ArtifactField<NoInfer<D>>;
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
   * With `query`, the list is query-backed: code defines its membership and order, editors
   * cannot pick, remove or reorder records, and nothing is stored on the block.
   *
   * @example
   * field.referenceList(customers, { maxItems: 6, toMarkdown: ({ content }) => [content.name] })
   * field.referenceList(articles, { query: { orderBy: { publishedAt: "desc" }, limit: 3 } })
   */
  referenceList: <T extends Record<string, TSchema>, const L extends number = number>(
    collection: Collection<T>,
    options?: {
      title?: string;
      description?: string;
      maxItems?: number;
      query?: ReferenceQuery<T, L>;
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
   *   toTitle: ({ content }) => content.title,
   *   toMarkdown: ({ content, settings }) => [
   *     `### ${content.title}`,
   *     settings.highlighted(content.description),
   *   ],
   * })
   */
  repeater: <
    T extends Record<string, TSchema>,
    S extends Record<string, TSchema> = Record<string, never>,
    N extends BlockStructuredData = BlockStructuredData,
  >(options: {
    content: (field: ContentFieldBuilder) => T & NoInfer<ArtifactDataCheck<T, S>>;
    settings?: (setting: SettingBuilder) => S;
    minItems: number;
    maxItems: number;
    title?: string;
    /** Names each item until it has a Summary, such as its title. See `ToTitleBuilder`. */
    toTitle: ToTitleBuilder<T, S>;
    toMarkdown: ToMarkdownBuilder<T, S>;
    /**
     * The nodes each item shows, placed wherever the parent's template places the repeater's
     * token. See `ToStructuredDataBuilder`.
     *
     * @example
     * toStructuredData: ({ content }) => ({
     *   "@type": "Question",
     *   name: content.question,
     *   acceptedAnswer: { "@type": "Answer", text: content.answer },
     * })
     */
    toStructuredData?: ToStructuredDataBuilder<T, S, N>;
  }) => RepeaterField<T, S>;
}

/** Content fields that can't be Artifact Data: artifact sources, repeaters and references. */
type UnsharedField =
  | { fieldType: "Artifact" | "Reference" | "ReferenceList" }
  | TArray<TObject<any>>;

/** The sibling names an artifact can list in `data`: shared content fields, then settings. */
export type ArtifactDataName<
  T extends Record<string, TSchema>,
  S extends Record<string, TSchema>,
> =
  | { [K in keyof T & string]: T[K] extends UnsharedField ? never : K }[keyof T & string]
  // Without settings, `S` is `Record<string, never>`, whose keys would accept any name.
  | (string extends keyof S ? never : keyof S & string);

/**
 * Checks each artifact's `data` against its siblings. Applied to the `content` callback's return
 * type, because callback parameters are context-sensitive (ADR 0001).
 */
export type ArtifactDataCheck<
  T extends Record<string, TSchema>,
  S extends Record<string, TSchema>,
> =
  true extends HasAnyField<T>
    ? unknown
    : { [K in ArtifactKey<T>]: ArtifactField<ArtifactDataName<T, S>> };

/** Shapes with fields that already fail to type check (`any`) are left to that error. */
type HasAnyField<T extends Record<string, TSchema>> = {
  [K in keyof T]-?: 0 extends 1 & T[K] ? true : false;
}[keyof T];
type ArtifactKey<T extends Record<string, TSchema>> = {
  [K in keyof T & string]-?: T[K] extends { fieldType: "Artifact" } ? K : never;
}[keyof T & string];

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
  "imageList" | "fileList" | "embed"
> {
  /**
   * An image asset. Never required: collection fields can't be (the API rejects it).
   *
   * @example
   * field.image({ title: "Cover" })
   */
  image: (options?: { title?: string }) => ImageField;
  /**
   * A file asset. Never required: collection fields can't be (the API rejects it).
   *
   * @example
   * field.file({ accept: ["application/pdf"], title: "Brochure" })
   */
  file: (options: { accept: string[]; title?: string }) => FileField;
  /**
   * An ordered list of distinct records of another collection, e.g. an article's co-authors.
   * Collections hold manual lists only: a query would fan out across a whole collection.
   *
   * @example
   * field.referenceList(authors, { title: "Co-authors" })
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

/**
 * Checks a query against its collection, for callers that bypass the types (computed limits
 * included); definition sync applies the same rules.
 */
function validateQuery(query: ReferenceQuery<any>, collection: Collection<any>) {
  const problem = referenceQueryProblem(
    query,
    (key) => collectionField(collection._internal, key)?.fieldType,
  );
  if (problem) throw new Error(`Query on "${collection._internal.id}": ${problem}`);
  return query;
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
        // Empty while a link switched to a page has no page picked yet.
        pageId: { anyOf: [{ const: "" }, uuidv7JsonSchema] },
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
  artifact: (options) =>
    TypeBoxType.Unsafe<ArtifactSource>({
      type: "string",
      maxLength: ARTIFACT_MAX_LENGTH,
      size: options.size,
      ...(options.data?.length ? { data: [...options.data] } : {}),
      default: options.default ?? "",
      title: options.title,
      fieldType: "Artifact" as const,
    }) as ArtifactField<never>,
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
    }) as ReferenceSchema<T>,
  referenceList: <T extends Record<string, TSchema>>(
    collection: Collection<T>,
    options: {
      title?: string;
      description?: string;
      maxItems?: number;
      query?: ReferenceQuery<T, any>;
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
      // A query-backed list stores nothing, so it has no default; editors never write it.
      ...(options.query === undefined
        ? { default: [] }
        : { query: validateQuery(options.query, collection) }),
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
      // Used by the typed child scope, not a copy of a record's content.
      referenceSchema: collection._internal.contentSchema,
    }) as ReferenceListSchema<T>,
  repeater: <
    T extends Record<string, TSchema>,
    S extends Record<string, TSchema> = Record<string, never>,
    N extends BlockStructuredData = BlockStructuredData,
  >(options: {
    content: (field: ContentFieldBuilder) => T & NoInfer<ArtifactDataCheck<T, S>>;
    settings?: (setting: SettingBuilder) => S;
    minItems: number;
    maxItems: number;
    title?: string;
    /** Names each item until it has a Summary, such as its title. See `ToTitleBuilder`. */
    toTitle: ToTitleBuilder<T, S>;
    toMarkdown: ToMarkdownBuilder<T, S>;
    /**
     * The nodes each item shows, placed wherever the parent's template places the repeater's
     * token. See `ToStructuredDataBuilder`.
     *
     * @example
     * toStructuredData: ({ content }) => ({
     *   "@type": "Question",
     *   name: content.question,
     *   acceptedAnswer: { "@type": "Answer", text: content.answer },
     * })
     */
    toStructuredData?: ToStructuredDataBuilder<T, S, N>;
  }): RepeaterField<T, S> => {
    if (options.minItems < 1) {
      throw new Error("Repeater requires minItems to be at least 1");
    }

    const content: T = options.content(contentFieldBuilder);
    const settings = options.settings?.(settingBuilder);
    const owner = `Repeater${options.title ? ` "${options.title}"` : ""}`;
    assertFieldKinds(content, "content", owner);
    if (settings) assertFieldKinds(settings, "settings", owner);
    attachArtifactData(content, settings, owner);

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
      // JSON has no Infinity: serialized, it would become a `null` limit.
      ...(Number.isFinite(options.maxItems) ? { maxItems: options.maxItems } : {}),
      default: defaultArray,
      title: options.title,
      fieldType: "Repeater" as const,
      toTitle: resolveToTitle<T, S>(options.toTitle, settings, "item", content),
      toMarkdown: resolveToMarkdown<T, S>(options.toMarkdown, settings, "item", content),
      ...(options.toStructuredData && {
        toStructuredData: resolveToStructuredData<T, S>(
          options.toStructuredData,
          settings,
          "item",
          content,
        ),
      }),
      itemSettingsSchema,
      defaultItemSettings: settingsObjectSchema
        ? collectSchemaDefaults(settingsObjectSchema.properties)
        : undefined,
    });
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
  image: (options = {}) => contentFieldBuilder.image({ title: options.title }),
  imageList: contentFieldBuilder.imageList,
  file: (options) => contentFieldBuilder.file({ accept: options.accept, title: options.title }),
  fileList: contentFieldBuilder.fileList,
  embed: contentFieldBuilder.embed,
  reference: (collection, options = {}) =>
    contentFieldBuilder.reference(collection, { title: options.title }),
  referenceList: (collection, options = {}) => {
    if ("query" in options) {
      throw new Error("Collections cannot hold query-backed reference lists");
    }
    return contentFieldBuilder.referenceList(collection, options);
  },
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
  attachArtifactData(content, settings, owner);
  return { content, settings };
}
