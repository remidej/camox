import { Type as TypeBoxType, type TSchema, type Static } from "@sinclair/typebox";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSelector } from "@xstate/store-react";
import { generateKeyBetween } from "fractional-indexing";
import * as React from "react";

import { useLocation } from "@/features/navigation/navigation";
import { useProjectSlug } from "@/lib/auth";
import { invalidateCollectionRecordViews } from "@/lib/collection-cache";
import {
  blockMutations,
  repeatableItemMutations,
  type Page,
  pageQueries,
  projectQueries,
  collectionMutations,
  collectionQueries,
} from "@/lib/queries";

import { useFrame } from "../../features/preview/components/Frame";
import { overlayFieldId } from "../../features/preview/overlayMessages";
import {
  usePreviewSelection,
  usePreviewTargetSelection,
  type SelectionEvent,
} from "../../features/preview/previewSelection";
import {
  previewStore,
  selectIsCommentMode,
  type RecordPlacement,
} from "../../features/preview/previewStore";
import { referencePickerFocus } from "../../features/preview/referencePickerFocus";
import { useOptionalCamoxApp } from "../../features/provider/components/CamoxAppContext";
import { useNormalizedData, isItemMarker, resolveAssetValue } from "../../lib/normalized-data";
import { InlineLexicalEditor } from "../components/lexical/InlineLexicalEditor";
import { useFieldSelection, useRecordSelection } from "../hooks/useFieldSelection.ts";
import { useIsEditable } from "../hooks/useIsEditable.ts";
import { useOverlayMessage } from "../hooks/useOverlayMessage.ts";
import { useOverlayState } from "../hooks/useOverlayState";
import {
  Type,
  resolveToMarkdown,
  type EmbedURL,
  type LinkValue,
  type ImageValue,
  type FileValue,
  type ToMarkdownBuilder,
  type ItemSettingsBrand,
} from "../lib/contentType.ts";
import type { FieldType } from "../lib/fieldTypes.tsx";
import { IconSvg, type IconProps } from "../lib/icons";
import type { IconValue } from "../lib/iconTypes";
import { renderImagePlaceholder } from "../lib/imagePlaceholder";
import {
  buildImageSrcSet,
  getDefaultImageSizes,
  getDefaultImageWidth,
  transformImageUrl,
} from "../lib/imageTransform";
import { markdownToReactNodes, type InlineTextStyles } from "../lib/lexicalReact";
import {
  resolveReference,
  resolveReferenceList,
  referenceOccurrenceId,
  type ReferenceContent,
  type ReferenceKeys,
  type ReferenceListKeys,
  type ReferenceScope,
} from "../lib/reference";
import { referenceWritesFor } from "./referenceWrites";

export { Type };
export type {
  InlineStyle,
  InlineTextStyles,
  TextStyleData,
  TextLinkStyleData,
} from "../lib/lexicalReact";

/** Normalize legacy links (no `type` field) to the new union shape */
const normalizeLinkValue = (value: Record<string, unknown>): LinkValue => {
  if (!value.type) {
    return { type: "external", ...value } as LinkValue;
  }
  return value as LinkValue;
};

/**
 * Resolve a LinkValue to an href string.
 *
 * Hash-only and empty hrefs are anchored to `currentPathname` so TanStack Router's
 * `<Link to>` builds the same `href` on SSR and client — bare `"#"` otherwise
 * resolves inconsistently across environments, causing hydration mismatches.
 */
const resolveLinkHref = (
  link: LinkValue,
  pages: Array<{ id: number; fullPath: string }> | undefined,
  currentPathname: string,
): string => {
  if (link.type === "page") {
    const page = pages?.find((p) => String(p.id) === link.pageId);
    return page?.fullPath ?? currentPathname;
  }
  if (!link.href || link.href.startsWith("#")) {
    return `${currentPathname}${link.href ?? ""}`;
  }
  return link.href;
};

/* -------------------------------------------------------------------------------------------------
 * createBlock
 * -----------------------------------------------------------------------------------------------*/

interface CreateBlockOptions<
  TSchemaShape extends Record<string, TSchema> = Record<string, TSchema>,
  TSettingsShape extends Record<string, TSchema> = Record<string, TSchema>,
  TLayoutOnly extends boolean = false,
> {
  id: string;
  /**
   * Human-readable title for the block (JSON Schema `title`).
   */
  title: string;
  /**
   * Description for AI agents on when and how to use this block (JSON Schema `description`).
   * This should describe the block's purpose, typical use cases, and any important
   * considerations for placement or configuration.
   */
  description: string;
  /**
   * Schema defining the structure of the block's editable content.
   * All fields must have default values.
   * Use Type.String() and Type.Repeater() to define the schema.
   *
   * @example
   * content: {
   *   title: Type.String({ default: 'Hello' }),
   *   items: Type.Repeater({
   *     content: { name: Type.String({ default: 'Item' }) },
   *     minItems: 1,
   *     maxItems: 10,
   *     toMarkdown: (c) => [c.name],
   *   })
   * }
   */
  content: TSchemaShape;
  /**
   * Optional schema defining block-level settings (e.g. layout variant, toggles).
   * Settings are not inline-editable; they use Type.Enum() and Type.Boolean().
   *
   * @example
   * settings: {
   *   alignment: Type.Enum({ default: 'left', options: { left: 'Left', center: 'Center' } }),
   *   showBackground: Type.Boolean({ default: true })
   * }
   */
  settings?: TSettingsShape;
  /**
   * When true, this block can only be used inside layouts and won't appear in the block picker
   * or be available for AI page generation.
   */
  layoutOnly?: TLayoutOnly;
  /** Share content and settings across all placements of this block definition. Defaults to false. */
  synced?: boolean;
  /**
   * React component that renders the block.
   * Must be defined as a separate function (not inline, not an arrow function).
   * Should use the Field component returned by createBlock to render editable content.
   */
  component: React.ComponentType<{
    content: Static<ReturnType<typeof TypeBoxType.Object<TSchemaShape>>>;
  }>;
  /**
   * Builder for rendering block content as markdown.
   * `c` is a proxy typed on `content` keys — `c.title`, `c.description`, etc.
   * `s` is a proxy typed on `settings` keys — call a boolean setting with a line
   * (`s.showCta(c.cta)`) or an enum with a value (`s.variant("banner", [...])`)
   * to wrap lines in a conditional. Each returned entry becomes a paragraph
   * (joined with `\n\n`). Lines where all referenced fields resolve to empty
   * (or whose condition is false) are omitted at render time.
   *
   * @example
   * toMarkdown: (c, s) => [`# ${c.title}`, c.description, s.showCta(c.cta)]
   */
  toMarkdown: ToMarkdownBuilder<TSchemaShape, TSettingsShape>;
}

interface BlockData<TContent> {
  _id: number;
  type: string;
  content: TContent;
  settings?: Record<string, unknown>;
  position: string;
}

export interface BlockComponentProps<TContent> {
  blockData: BlockData<TContent>;
  mode: "site" | "peek" | "layout";
  isFirstBlock?: boolean;
  showAddBlockTop?: boolean;
  showAddBlockBottom?: boolean;
  addBlockAfterPosition?: string | null;
}

/* -------------------------------------------------------------------------------------------------
 * Peek bundle helpers — generate fake normalized data for block previews
 * -----------------------------------------------------------------------------------------------*/

export interface PeekItem {
  id: number;
  blockId: number;
  parentItemId: number | null;
  fieldName: string;
  content: unknown;
  settings: Record<string, unknown> | null;
  summary: string;
  position: string;
  createdAt: number;
  updatedAt: number;
}

export interface RepeatableItemSeed {
  tempId: string;
  parentTempId: string | null;
  fieldName: string;
  content: Record<string, unknown>;
  settings?: Record<string, unknown>;
  position: string;
}

/**
 * Recursively walks schema properties to generate RepeatableItemSeed objects.
 * Sets `_itemId` placeholder markers on `content` for each repeatable field,
 * and pushes seed objects into `allSeeds`.
 */
function buildInitialSeeds(
  properties: Record<string, any>,
  parentTempId: string | null,
  content: Record<string, unknown>,
  allSeeds: RepeatableItemSeed[],
  counter: { value: number },
) {
  for (const [fieldName, fieldSchema] of Object.entries(properties)) {
    if (fieldSchema.type !== "array" || !fieldSchema.items?.properties) continue;
    // Skip asset list fields — defaultItems is only for peek previews,
    // not for creating real DB rows with placeholder content
    const ft = fieldSchema.fieldType;
    if (ft === "ImageList" || ft === "FileList") continue;
    const defaultCount = fieldSchema.defaultItems ?? fieldSchema.minItems ?? 0;
    if (defaultCount <= 0) continue;

    const itemProperties = fieldSchema.items.properties as Record<string, any>;

    // Build default item content, excluding nested repeatable sub-fields
    const itemContent: Record<string, unknown> = {};
    for (const [propName, propSchema] of Object.entries(itemProperties)) {
      if (propSchema.type === "array" && propSchema.items?.properties) continue;
      if ("default" in propSchema) {
        itemContent[propName] = propSchema.default;
      }
    }

    const itemSettingsDefaults = fieldSchema.defaultItemSettings as
      | Record<string, unknown>
      | undefined;

    const markers: { _itemId: string }[] = [];
    let prevPosition: string | null = null;

    for (let i = 0; i < defaultCount; i++) {
      const tempId = `seed_${++counter.value}`;
      const position = generateKeyBetween(prevPosition, null);
      prevPosition = position;

      allSeeds.push({
        tempId,
        parentTempId,
        fieldName,
        content: { ...itemContent },
        settings: itemSettingsDefaults ? { ...itemSettingsDefaults } : undefined,
        position,
      });

      markers.push({ _itemId: tempId });

      // Recurse into nested repeatable fields within this item.
      // Use a throwaway object so nested _itemId markers don't pollute the seed's stored content.
      const nestedDiscard: Record<string, unknown> = {};
      buildInitialSeeds(itemProperties, tempId, nestedDiscard, allSeeds, counter);
    }

    content[fieldName] = markers;
  }
}

/**
 * Recursively walks schema properties to generate fake repeatable items for peek mode.
 * Sets `_itemId` markers on `content` for each repeatable field,
 * and pushes the corresponding fake items into `allItems`.
 */
function buildPeekItems(
  properties: Record<string, any>,
  blockId: number,
  parentItemId: number | null,
  content: Record<string, unknown>,
  allItems: PeekItem[],
  counter: { value: number },
) {
  for (const [fieldName, fieldSchema] of Object.entries(properties)) {
    if (fieldSchema.type !== "array" || !fieldSchema.items?.properties) continue;
    // Asset list arrays are inline _fileId markers, not nested DB items.
    // ImageList/FileList synthesize default placeholders at render time.
    if (fieldSchema.fieldType === "ImageList" || fieldSchema.fieldType === "FileList") continue;
    const defaultCount = fieldSchema.defaultItems ?? fieldSchema.minItems ?? 0;
    if (defaultCount <= 0) continue;

    const itemProperties = fieldSchema.items.properties as Record<string, any>;

    // Build default item content, excluding nested repeatable sub-fields
    const itemContent: Record<string, unknown> = {};
    for (const [propName, propSchema] of Object.entries(itemProperties)) {
      if (propSchema.type === "array" && propSchema.items?.properties) continue;
      if ("default" in propSchema) {
        itemContent[propName] = propSchema.default;
      }
    }

    const itemSettingsDefaults = fieldSchema.defaultItemSettings as
      | Record<string, unknown>
      | undefined;

    const markers: { _itemId: number }[] = [];
    let prevPosition: string | null = null;

    for (let i = 0; i < defaultCount; i++) {
      const itemId = --counter.value;
      const position = generateKeyBetween(prevPosition, null);
      prevPosition = position;

      allItems.push({
        id: itemId,
        blockId,
        parentItemId,
        fieldName,
        content: { ...itemContent },
        settings: itemSettingsDefaults ? { ...itemSettingsDefaults } : null,
        summary: "",
        position,
        createdAt: 0,
        updatedAt: 0,
      });

      markers.push({ _itemId: itemId });

      // Recurse into nested repeatable fields within this item
      const nestedContent: Record<string, unknown> = {};
      buildPeekItems(itemProperties, blockId, itemId, nestedContent, allItems, counter);

      // Merge nested _itemId markers into the item's content
      const item = allItems.find((it) => it.id === itemId)!;
      item.content = { ...(item.content as Record<string, unknown>), ...nestedContent };
    }

    content[fieldName] = markers;
  }
}

export function createEditableBlock<
  TSchemaShape extends Record<string, TSchema>,
  TSettingsShape extends Record<string, TSchema> = Record<string, never>,
  TLayoutOnly extends boolean = false,
>(options: CreateBlockOptions<TSchemaShape, TSettingsShape, TLayoutOnly>) {
  // Build TypeBox schema for runtime validation and default value creation
  const typeboxSchema = TypeBoxType.Object(options.content);

  // Build a richer JSON Schema object
  const contentSchema = {
    type: "object" as const,
    title: options.title,
    description: options.description,
    properties: typeboxSchema.properties,
    required: Object.keys(options.content),
    toMarkdown: resolveToMarkdown<TSchemaShape, TSettingsShape>(
      options.toMarkdown,
      options.settings,
      "block",
      options.content,
    ),
  };

  // Build settings schema (if provided)
  const settingsTypeboxSchema = options.settings ? TypeBoxType.Object(options.settings) : null;

  const settingsSchema = settingsTypeboxSchema
    ? {
        type: "object" as const,
        properties: settingsTypeboxSchema.properties,
        required: Object.keys(options.settings!),
      }
    : undefined;

  // Extract defaults manually since Value.Create doesn't support Unsafe types (used by Type.Enum and Type.Embed)
  const contentDefaults: Record<string, unknown> = {};
  const contentDefaultsForStorage: Record<string, unknown> = {};
  for (const [key, prop] of Object.entries(typeboxSchema.properties)) {
    if ("default" in prop) {
      contentDefaults[key] = prop.default;
      // Exclude asset fields and repeatable arrays from storage defaults —
      // assets use placeholders at the rendering layer, repeatables are stored as separate DB rows
      const ft = (prop as any).fieldType;
      if (
        ft === "Image" ||
        ft === "File" ||
        ft === "ImageList" ||
        ft === "FileList" ||
        ft === "Repeater"
      ) {
        continue;
      }
      contentDefaultsForStorage[key] = prop.default;
    }
  }

  // Extract per-item defaults for repeatable (array) fields
  const repeatableItemDefaults: Record<string, Record<string, unknown>> = {};
  const repeatableItemSettingsDefaults: Record<string, Record<string, unknown>> = {};
  for (const [key, prop] of Object.entries(typeboxSchema.properties)) {
    const p = prop as any;
    if (p.type === "array" && p.items?.properties) {
      const itemDefaults: Record<string, unknown> = {};
      for (const [itemKey, itemProp] of Object.entries(p.items.properties)) {
        if (itemProp && typeof itemProp === "object" && "default" in itemProp) {
          itemDefaults[itemKey] = (itemProp as any).default;
        }
      }
      if (Object.keys(itemDefaults).length > 0) {
        repeatableItemDefaults[key] = itemDefaults;
      }
      if (p.defaultItemSettings && typeof p.defaultItemSettings === "object") {
        repeatableItemSettingsDefaults[key] = p.defaultItemSettings as Record<string, unknown>;
      }
    }
  }

  const settingsDefaults: Record<string, unknown> = {};
  if (settingsTypeboxSchema) {
    for (const [key, prop] of Object.entries(settingsTypeboxSchema.properties)) {
      if ("default" in prop) {
        settingsDefaults[key] = prop.default;
      }
    }
  }

  type TContent = Static<typeof typeboxSchema>;
  type TSettings =
    TSettingsShape extends Record<string, never>
      ? Record<string, never>
      : Static<ReturnType<typeof TypeBoxType.Object<TSettingsShape>>>;

  type BlockContextValue = {
    blockId: number;
    content: TContent;
    sourceSchema?: Record<string, any>;
    settings: TSettings;
    isHovered: boolean;
    setIsHovered: React.Dispatch<React.SetStateAction<boolean>>;
  } & Pick<BlockComponentProps<TContent>, "mode">;

  interface RepeatableItemContextValue {
    arrayFieldName: string;
    itemIndex: number;
    itemContent: any;
    itemSettings: Record<string, unknown>;
    itemId?: number;
    /**
     * Nearest ancestor item with a normalized (DB-backed) id. Used so clicks
     * inside inline arrays (e.g. multi-asset galleries) can attribute the
     * selection to the enclosing DB item rather than to the block.
     */
    containerItemId?: number;
  }

  const Context = React.createContext<BlockContextValue | null>(null);
  const RepeatableItemContext = React.createContext<RepeatableItemContextValue | null>(null);
  type ReferenceContextValue = {
    placement: RecordPlacement;
    selectRecordField: (
      recordFieldName: string,
      recordFieldType: FieldType,
      event?: SelectionEvent,
    ) => void;
    update: (field: string, value: string) => void;
  };
  const ReferenceContext = React.createContext<ReferenceContextValue | null>(null);

  // Context to track if the parent repeater container is being hovered from sidebar
  const RepeaterHoverContext = React.createContext<string | null>(null);

  /**
   * The field ID shared with the sidebar (see `overlayFieldId`). Inside a placed record,
   * the field is a record field of that placement.
   */
  const getOverlayFieldId = (
    blockId: number,
    fieldName: string,
    scope: { itemId?: number | null; reference?: ReferenceContextValue | null } = {},
  ): string =>
    scope.reference
      ? overlayFieldId(blockId, fieldName, {
          referenceFieldName: scope.reference.placement.fieldName,
        })
      : overlayFieldId(blockId, fieldName, { itemId: scope.itemId });

  // Only allow string fields - not objects, arrays, or embed URLs
  type StringFields = {
    [K in keyof TContent as TContent[K] extends EmbedURL | IconValue
      ? never
      : TContent[K] extends string
        ? K
        : never]: TContent[K];
  };

  // Only allow embed URL fields
  type IconFields = {
    [K in keyof TContent as TContent[K] extends IconValue ? K : never]: TContent[K];
  };
  type ItemIconFields<K extends keyof RepeatableFields> = {
    [F in keyof RepeatableItemType<K> as RepeatableItemType<K>[F] extends IconValue
      ? F
      : never]: RepeatableItemType<K>[F];
  };

  type EmbedFields = {
    [K in keyof TContent as TContent[K] extends EmbedURL ? K : never]: TContent[K];
  };

  // Only allow link fields
  type LinkFields = {
    [K in keyof TContent as TContent[K] extends LinkValue ? K : never]: TContent[K];
  };

  // Only allow image fields
  type ImageFields = {
    [K in keyof TContent as ImageValue extends TContent[K]
      ? TContent[K] extends ImageValue
        ? K
        : never
      : never]: TContent[K];
  };

  // Only allow file fields
  type FileFields = {
    [K in keyof TContent as FileValue extends TContent[K]
      ? TContent[K] extends FileValue
        ? K
        : never
      : never]: TContent[K];
  };

  // Top-level Type.ImageList() fields
  type ImageListFields = {
    [K in keyof TContent as TContent[K] extends Array<infer U>
      ? ImageValue extends U
        ? U extends ImageValue
          ? K
          : never
        : never
      : never]: TContent[K];
  };

  // Top-level Type.FileList() fields
  type FileListFields = {
    [K in keyof TContent as TContent[K] extends Array<infer U>
      ? FileValue extends U
        ? U extends FileValue
          ? K
          : never
        : never
      : never]: TContent[K];
  };

  // Only allow array fields from Type.Repeater (excludes asset list arrays —
  // those are handled by ImageList/FileList and intentionally rejected here so
  // <block.Repeater name="gallery"> on a Type.ImageList() is a TS error).
  type RepeatableFields = {
    [K in keyof TContent as TContent[K] extends Array<infer U>
      ? ImageValue extends U
        ? never
        : FileValue extends U
          ? never
          : // Reference lists store record ids, not items.
            U extends string
            ? never
            : K
      : never]: TContent[K];
  };

  // Extract the element type from a repeatable array field
  type RepeatableItemType<K extends keyof RepeatableFields> =
    RepeatableFields[K] extends Array<infer U> ? U : never;

  // Extract string fields from a repeatable item type
  type ItemStringFields<K extends keyof RepeatableFields> = {
    [F in keyof RepeatableItemType<K> as RepeatableItemType<K>[F] extends IconValue
      ? never
      : RepeatableItemType<K>[F] extends string
        ? F
        : never]: RepeatableItemType<K>[F];
  };

  // Extract link fields from a repeatable item type
  type ItemLinkFields<K extends keyof RepeatableFields> = {
    [F in keyof RepeatableItemType<K> as RepeatableItemType<K>[F] extends LinkValue
      ? F
      : never]: RepeatableItemType<K>[F];
  };

  // Extract embed URL fields from a repeatable item type
  type ItemEmbedFields<K extends keyof RepeatableFields> = {
    [F in keyof RepeatableItemType<K> as RepeatableItemType<K>[F] extends EmbedURL
      ? F
      : never]: RepeatableItemType<K>[F];
  };

  // Extract image fields from a repeatable item type
  type ItemImageFields<K extends keyof RepeatableFields> = {
    [F in keyof RepeatableItemType<K> as ImageValue extends RepeatableItemType<K>[F]
      ? RepeatableItemType<K>[F] extends ImageValue
        ? F
        : never
      : never]: RepeatableItemType<K>[F];
  };

  // Extract file fields from a repeatable item type
  type ItemFileFields<K extends keyof RepeatableFields> = {
    [F in keyof RepeatableItemType<K> as FileValue extends RepeatableItemType<K>[F]
      ? RepeatableItemType<K>[F] extends FileValue
        ? F
        : never
      : never]: RepeatableItemType<K>[F];
  };

  // Extract Type.ImageList() fields nested inside a Repeater
  type ItemImageListFields<K extends keyof RepeatableFields> = {
    [F in keyof RepeatableItemType<K> as RepeatableItemType<K>[F] extends Array<infer U>
      ? ImageValue extends U
        ? U extends ImageValue
          ? F
          : never
        : never
      : never]: RepeatableItemType<K>[F];
  };

  // Extract Type.FileList() fields nested inside a Repeater
  type ItemFileListFields<K extends keyof RepeatableFields> = {
    [F in keyof RepeatableItemType<K> as RepeatableItemType<K>[F] extends Array<infer U>
      ? FileValue extends U
        ? U extends FileValue
          ? F
          : never
        : never
      : never]: RepeatableItemType<K>[F];
  };

  // Extract nested Type.Repeater array fields (excludes asset list arrays)
  type ItemRepeatableFields<K extends keyof RepeatableFields> = {
    [F in keyof RepeatableItemType<K> as RepeatableItemType<K>[F] extends Array<infer U>
      ? ImageValue extends U
        ? never
        : FileValue extends U
          ? never
          : F
      : never]: RepeatableItemType<K>[F];
  };

  // Extract the per-item settings shape recorded by Type.Repeater
  // via the `WithItemSettings` phantom brand.
  type ItemSettingsStatic<K extends keyof RepeatableFields> = TSchemaShape[K] extends {
    readonly [ItemSettingsBrand]?: infer S;
  }
    ? S extends Record<string, TSchema>
      ? Static<ReturnType<typeof TypeBoxType.Object<S>>>
      : Record<string, never>
    : Record<string, never>;

  /* ----- Render prop types ------------------------------------------------
   * These describe exactly what `props` (and `data`) each field renderer
   * passes to its children callback.  Block authors get full autocomplete;
   * the `satisfies` assertions on the objects that build these props ensure
   * no stale / mistyped key can sneak in.
   * ---------------------------------------------------------------------- */

  /** Common overlay props passed to editable field render functions.
   *  Field and Link spread these onto the user's element for canvas measurement.
   *  Image and Embed keep them on an internal wrapper that also handles editing
   *  interactions, so their render-prop types don't include these. */
  type EditableProps = {
    ref?: React.Ref<any>;
    "data-camox-field-id"?: string;
    "data-camox-hovered"?: boolean;
    "data-camox-focused"?: boolean;
    "data-camox-overlay-mode"?: string;
    onMouseEnter?: () => void;
    onMouseLeave?: () => void;
    onClickCapture?: (event: React.MouseEvent<HTMLElement>) => void;
  };

  type FieldRenderProps = { children: React.ReactNode } & EditableProps;
  type FieldRenderData = {
    /** Raw markdown source. Use `props.children` for rendered content. */
    text: string;
  };

  type LinkRenderProps = {
    to: string;
    children: React.ReactNode;
    target?: string;
    rel?: string;
    contentEditable?: boolean;
    onClick?: (e: React.MouseEvent) => void;
    onInput?: (e: React.FormEvent<HTMLElement>) => void;
    onFocus?: () => void;
    onBlur?: () => void;
    onKeyDown?: (e: React.KeyboardEvent) => void;
    spellCheck?: boolean;
    suppressContentEditableWarning?: boolean;
  } & EditableProps;

  type LinkRenderData = { text: string; href: string; newTab: boolean };

  type ImageRenderProps = {
    src: string;
    alt: string;
    srcSet?: string;
    sizes?: string;
  };

  type FileRenderProps = {
    href: string;
    download: string;
  } & EditableFileLinkProps;
  /** Present only while a file is selectable in the editor; spread onto the file link with the rest. */
  type EditableFileLinkProps = Partial<
    Pick<
      React.AnchorHTMLAttributes<HTMLAnchorElement>,
      "onClick" | "onClickCapture" | "onMouseEnter" | "onMouseLeave"
    >
  > & { [attribute: `data-camox-${string}`]: string | boolean | undefined };

  type EmbedRenderProps = {
    src: string;
  };

  type EmbedRenderData = { url: string };

  type DetachedRenderProps = {
    "data-camox-block-id"?: number;
    "data-camox-hovered"?: boolean;
    "data-camox-focused"?: boolean;
    "data-camox-overlay-mode"?: "synced";
    onClickCapture: (e: React.MouseEvent) => void;
    onMouseEnter: () => void;
    onMouseLeave: () => void;
  };

  const Field = <K extends keyof StringFields>({
    name,
    textStyle,
    linkStyle,
    children,
  }: InlineTextStyles & {
    name: K;
    children: (props: FieldRenderProps, data: FieldRenderData) => React.ReactNode;
  }): React.ReactNode => {
    const selectTarget = usePreviewSelection();
    const isCommentMode = useSelector(previewStore, selectIsCommentMode);
    const blockContext = React.use(Context);
    if (!blockContext) {
      throw new Error("Field must be used within a Block Component");
    }

    const { blockId, content, mode } = blockContext;
    const isContentEditable = useIsEditable(mode);
    const elementRef = React.useRef<HTMLElement>(null);
    const { window: iframeWindow } = useFrame();
    const projectSlug = useProjectSlug();
    const { data: project } = useQuery(projectQueries.getBySlug(projectSlug));
    const { data: pages } = useQuery({
      ...pageQueries.list(project?.id ?? 0),
      enabled: !!project,
    });
    const currentPathname = useLocation({ select: (l) => l.pathname });

    // Check if we're inside a Repeater
    const repeaterContext = React.use(RepeatableItemContext);

    // Generate unique field ID for overlay tracking
    const reference = React.use(ReferenceContext);
    const fieldId = getOverlayFieldId(blockId, String(name), {
      itemId: repeaterContext?.itemId,
      reference,
    });

    // Get field value based on context
    const fieldValue = (repeaterContext ? repeaterContext.itemContent[name] : content[name]) as
      | string
      | Record<string, unknown>;

    // Local hover/focus state for overlay styling
    const [isHovered, setIsHovered] = React.useState(false);
    const [isEditorFocused, setIsEditorFocused] = React.useState(false);

    // Derive selected state from selection
    const isBlockFieldSelected = useFieldSelection(
      blockId,
      String(name),
      "String",
      repeaterContext?.itemId,
    );
    const isRecordFieldSelected = useRecordSelection(reference?.placement ?? null, String(name));
    const isSelectedFromSelection = reference ? isRecordFieldSelected : isBlockFieldSelected;

    const isFocused = isEditorFocused || isSelectedFromSelection;
    const overlayState = useOverlayState(isHovered, isFocused);

    // Keep sidebar hover via postMessage (transient state)
    const isHoveredFromSidebar = useOverlayMessage(
      iframeWindow,
      isContentEditable,
      "CAMOX_HOVER_FIELD",
      "CAMOX_HOVER_FIELD_END",
      { fieldId },
    );

    React.useEffect(() => {
      setIsHovered(isHoveredFromSidebar);
    }, [isHoveredFromSidebar]);

    const updateBlockContent = useMutation(blockMutations.updateContent());
    const updateRepeatableContent = useMutation(repeatableItemMutations.updateContent());

    const handleChange = React.useCallback(
      (newValue: string) => {
        if (reference) {
          reference.update(String(name), newValue);
          return;
        }
        if (repeaterContext) {
          const { itemId } = repeaterContext;
          if (itemId != null) {
            updateRepeatableContent.mutate({
              id: itemId,
              content: { [name]: newValue },
            });
          }
        } else {
          updateBlockContent.mutate({
            id: blockId,
            content: { [name]: newValue },
          });
        }
      },
      [blockId, name, reference, repeaterContext, updateBlockContent, updateRepeatableContent],
    );

    const selectField = (event?: React.MouseEvent<HTMLElement>) => {
      if (reference) {
        reference.selectRecordField(String(name), "String", event);
        return;
      }
      selectTarget(
        repeaterContext?.itemId != null
          ? {
              type: "item-field",
              blockId,
              itemId: repeaterContext.itemId,
              fieldName: String(name),
              fieldType: "String",
            }
          : { type: "block-field", blockId, fieldName: String(name), fieldType: "String" },
        event,
      );
    };
    const handleFocus = () => {
      if (selectIsCommentMode(previewStore.getSnapshot())) return;
      setIsEditorFocused(true);
      selectField();
    };

    const handleBlur = React.useCallback(() => {
      setIsEditorFocused(false);
    }, []);

    const handleMouseEnter = () => {
      if (isContentEditable) {
        setIsHovered(true);
      }
    };

    const handleMouseLeave = () => {
      if (isContentEditable) {
        setIsHovered(false);
      }
    };

    const fieldData = { text: fieldValue as string } satisfies FieldRenderData;

    if (!isContentEditable) {
      return (
        <>
          {children(
            {
              children: markdownToReactNodes(fieldValue, {
                pages: pages as Page[] | undefined,
                fallbackHref: currentPathname,
                textStyle,
                linkStyle,
              }),
            } satisfies FieldRenderProps,
            fieldData,
          )}
        </>
      );
    }

    const fieldProps = {
      ref: elementRef,
      "data-camox-field-id": fieldId,
      ...overlayState,
      "data-camox-overlay-mode": reference ? "reference" : options.synced ? "synced" : undefined,
      onMouseEnter: handleMouseEnter,
      onMouseLeave: handleMouseLeave,
      onClickCapture: selectField,
      children: isCommentMode ? (
        markdownToReactNodes(fieldValue, {
          pages: pages as Page[] | undefined,
          fallbackHref: currentPathname,
          textStyle,
          linkStyle,
        })
      ) : (
        <InlineLexicalEditor
          textStyle={textStyle}
          linkStyle={linkStyle}
          pages={pages as Page[] | undefined}
          fallbackHref={currentPathname}
          initialState={fieldValue}
          externalState={fieldValue}
          onChange={handleChange}
          onFocus={handleFocus}
          onBlur={handleBlur}
        />
      ),
    } satisfies FieldRenderProps;
    return <>{children(fieldProps, fieldData)}</>;
  };

  const Icon = ({ name, ...props }: IconProps & { name: keyof IconFields }) => {
    const block = React.use(Context);
    const item = React.use(RepeatableItemContext);
    const selectTarget = usePreviewSelection();
    if (!block) throw new Error("Icon must be used within a Block Component");
    const editable = useIsEditable(block.mode);
    const fieldName = String(name);
    const value = (item ? item.itemContent[name] : block.content[name]) as string;
    const fieldId = getOverlayFieldId(block.blockId, fieldName, { itemId: item?.itemId });
    const { window: iframeWindow } = useFrame();
    const [isHovered, setIsHovered] = React.useState(false);
    const isFocused = useFieldSelection(block.blockId, fieldName, "Icon", item?.itemId);
    const isHoveredFromSidebar = useOverlayMessage(
      iframeWindow,
      editable,
      "CAMOX_HOVER_FIELD",
      "CAMOX_HOVER_FIELD_END",
      { fieldId },
    );
    const overlayState = useOverlayState(isHovered || isHoveredFromSidebar, isFocused);
    return (
      <IconSvg
        {...props}
        iconId={value}
        data-camox-field-id={editable ? fieldId : undefined}
        data-camox-field-type={editable ? "icon" : undefined}
        {...(editable ? overlayState : {})}
        data-camox-overlay-mode={editable && options.synced ? "synced" : undefined}
        onMouseEnter={(event) => {
          if (editable) setIsHovered(true);
          props.onMouseEnter?.(event);
        }}
        onMouseLeave={(event) => {
          if (editable) setIsHovered(false);
          props.onMouseLeave?.(event);
        }}
        onClickCapture={
          editable
            ? (event) =>
                selectTarget(
                  item?.itemId != null
                    ? {
                        type: "item-field",
                        blockId: block.blockId,
                        itemId: item.itemId,
                        fieldName,
                        fieldType: "Icon",
                      }
                    : { type: "block-field", blockId: block.blockId, fieldName, fieldType: "Icon" },
                  event,
                )
            : props.onClickCapture
        }
      />
    );
  };

  const Embed = <K extends keyof EmbedFields>({
    name,
    children,
  }: {
    name: K;
    children: (props: EmbedRenderProps, data: EmbedRenderData) => React.ReactNode;
  }): React.ReactNode => {
    const selectTarget = usePreviewSelection();
    const blockContext = React.use(Context);
    if (!blockContext) {
      throw new Error("Embed must be used within a Block Component");
    }

    const { blockId, content, mode } = blockContext;
    const isContentEditable = useIsEditable(mode);
    const { window: iframeWindow } = useFrame();
    const repeaterContext = React.use(RepeatableItemContext);
    const fieldValue = repeaterContext
      ? (repeaterContext.itemContent[name] as string)
      : (content[name] as string);

    // Inside a placed record, the embed is a record field of that placement.
    const reference = React.use(ReferenceContext);
    const fieldId = getOverlayFieldId(blockId, String(name), {
      itemId: repeaterContext?.itemId,
      reference,
    });

    const [isHovered, setIsHovered] = React.useState(false);
    const isRecordFieldSelected = useRecordSelection(reference?.placement ?? null, String(name));
    const overlayState = useOverlayState(isHovered, reference != null && isRecordFieldSelected);
    const embedRef = React.useRef<HTMLDivElement>(null);
    const itemId = repeaterContext?.itemId;
    const selectField = React.useCallback(
      (event?: SelectionEvent) => {
        if (!isContentEditable) return;
        if (reference) {
          reference.selectRecordField(String(name), "Embed", event);
          return;
        }
        selectTarget(
          itemId != null
            ? { type: "item-field", blockId, itemId, fieldName: String(name), fieldType: "Embed" }
            : { type: "block-field", blockId, fieldName: String(name), fieldType: "Embed" },
          event,
        );
      },
      [isContentEditable, reference, blockId, itemId, name, selectTarget],
    );

    React.useEffect(() => {
      if (!isContentEditable || !iframeWindow) return;

      // Cross-origin player clicks don't bubble out of their iframe. Observe
      // focus entering the player instead, without intercepting its interaction.
      let timer: number | undefined;
      const handleBlur = () => {
        iframeWindow.clearTimeout(timer);
        timer = iframeWindow.setTimeout(() => {
          const activeElement = iframeWindow.document.activeElement;
          if (activeElement?.tagName !== "IFRAME") return;
          if (!embedRef.current?.contains(activeElement)) return;
          selectField({
            currentTarget: embedRef.current,
            preventDefault() {},
            stopPropagation() {},
          });
        }, 0);
      };
      iframeWindow.addEventListener("blur", handleBlur);
      return () => {
        iframeWindow.clearTimeout(timer);
        iframeWindow.removeEventListener("blur", handleBlur);
      };
    }, [isContentEditable, iframeWindow, selectField]);

    const isHoveredFromSidebar = useOverlayMessage(
      iframeWindow,
      isContentEditable,
      "CAMOX_HOVER_FIELD",
      "CAMOX_HOVER_FIELD_END",
      { fieldId },
    );

    React.useEffect(() => {
      setIsHovered(isHoveredFromSidebar);
    }, [isHoveredFromSidebar]);

    return (
      <div
        ref={embedRef}
        onClickCapture={selectField}
        data-camox-field-id={isContentEditable ? fieldId : undefined}
        data-camox-field-type={isContentEditable ? "embed" : undefined}
        {...(isContentEditable ? overlayState : {})}
        data-camox-overlay-mode={assetOverlayMode(reference)}
        onMouseEnter={isContentEditable ? () => setIsHovered(true) : undefined}
        onMouseLeave={isContentEditable ? () => setIsHovered(false) : undefined}
      >
        {children(
          { src: fieldValue } satisfies EmbedRenderProps,
          { url: fieldValue } satisfies EmbedRenderData,
        )}
      </div>
    );
  };

  const Link = <K extends keyof LinkFields>({
    name,
    children,
  }: {
    name: K;
    children: (props: LinkRenderProps, data: LinkRenderData) => React.ReactNode;
  }): React.ReactNode => {
    const selectTarget = usePreviewSelection();
    const isCommentMode = useSelector(previewStore, selectIsCommentMode);
    const blockContext = React.use(Context);
    if (!blockContext) {
      throw new Error("Link must be used within a Block Component");
    }

    const { blockId, content, mode } = blockContext;
    const isContentEditable = useIsEditable(mode);
    const elementRef = React.useRef<HTMLElement>(null);
    const { window: iframeWindow } = useFrame();
    const repeaterContext = React.use(RepeatableItemContext);
    const rawFieldValue = repeaterContext
      ? (repeaterContext.itemContent[name] as LinkValue)
      : (content[name] as LinkValue);
    const fieldValue = normalizeLinkValue(rawFieldValue as unknown as Record<string, unknown>);
    const updateBlockContent = useMutation(blockMutations.updateContent());
    const updateRepeatableContent = useMutation(repeatableItemMutations.updateContent());
    const projectSlug = useProjectSlug();
    const { data: project } = useQuery(projectQueries.getBySlug(projectSlug));
    const { data: pages } = useQuery({
      ...pageQueries.list(project?.id ?? 0),
      enabled: !!project,
    });
    const currentPathname = useLocation({ select: (l) => l.pathname });
    const resolvedHref = resolveLinkHref(fieldValue, pages as Page[] | undefined, currentPathname);

    const fieldId = getOverlayFieldId(blockId, String(name), { itemId: repeaterContext?.itemId });

    const [isEditing, setIsEditing] = React.useState(false);
    const [displayText, setDisplayText] = React.useState(fieldValue.text);
    const [isHovered, setIsHovered] = React.useState(false);
    const [isEditorFocused, setIsEditorFocused] = React.useState(false);

    // Derive selected state from selection
    const isSelectedFromSelection = useFieldSelection(
      blockId,
      String(name),
      "Link",
      repeaterContext?.itemId,
    );

    const isFocused = isEditorFocused || isSelectedFromSelection;
    const overlayState = useOverlayState(isHovered, isFocused);

    React.useEffect(() => {
      if (!isEditing) {
        setDisplayText(fieldValue.text);
      }
    }, [fieldValue.text, isEditing]);

    // Keep sidebar hover via postMessage (transient state)
    const isHoveredFromSidebar = useOverlayMessage(
      iframeWindow,
      isContentEditable,
      "CAMOX_HOVER_FIELD",
      "CAMOX_HOVER_FIELD_END",
      { fieldId },
    );

    React.useEffect(() => {
      setIsHovered(isHoveredFromSidebar);
    }, [isHoveredFromSidebar]);

    const saveLinkValue = (newLinkValue: Record<string, unknown>) => {
      if (repeaterContext?.itemId != null) {
        updateRepeatableContent.mutate({
          id: repeaterContext.itemId,
          content: { [name]: newLinkValue },
        });
      } else {
        updateBlockContent.mutate({
          id: blockId,
          content: { [name]: newLinkValue },
        });
      }
    };

    const handleInput = (e: React.FormEvent<HTMLElement>) => {
      const newText = (e.target as HTMLElement).textContent || "";
      saveLinkValue({ ...fieldValue, text: newText });
    };

    const selectField = (event?: React.MouseEvent<HTMLElement>) => {
      selectTarget(
        repeaterContext?.itemId != null
          ? {
              type: "item-field",
              blockId,
              itemId: repeaterContext.itemId,
              fieldName: String(name),
              fieldType: "Link",
            }
          : { type: "block-field", blockId, fieldName: String(name), fieldType: "Link" },
        event,
      );
    };
    const handleFocus = () => {
      if (selectIsCommentMode(previewStore.getSnapshot())) return;
      setIsEditing(true);
      setIsEditorFocused(true);
      selectField();
    };

    const handleBlur = () => {
      setIsEditing(false);
      setIsEditorFocused(false);
    };

    const linkData = {
      text: displayText,
      href: resolvedHref,
      newTab: fieldValue.newTab,
    } satisfies LinkRenderData;

    if (!isContentEditable) {
      return (
        <>
          {children(
            {
              to: resolvedHref,
              target: fieldValue.newTab ? "_blank" : undefined,
              rel: fieldValue.newTab ? "noreferrer" : undefined,
              children: fieldValue.text,
            } satisfies LinkRenderProps,
            linkData,
          )}
        </>
      );
    }

    const linkProps = {
      ref: elementRef,
      to: resolvedHref,
      target: fieldValue.newTab ? "_blank" : undefined,
      rel: fieldValue.newTab ? "noreferrer" : undefined,
      children: displayText,
      "data-camox-field-id": fieldId,
      ...overlayState,
      "data-camox-overlay-mode": options.synced ? "synced" : undefined,
      contentEditable: !isCommentMode,
      onClickCapture: selectField,
      onClick: (e: React.MouseEvent) => e.preventDefault(),
      onInput: handleInput,
      onFocus: handleFocus,
      onBlur: handleBlur,
      onMouseEnter: () => setIsHovered(true),
      onMouseLeave: () => setIsHovered(false),
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === "Escape") {
          (e.target as HTMLElement).blur();
        }
      },
      spellCheck: false,
      suppressContentEditableWarning: true,
    } satisfies LinkRenderProps;

    return <>{children(linkProps, linkData)}</>;
  };

  const assetOverlayMode = (reference: ReferenceContextValue | null) => {
    if (reference) return "reference";
    return options.synced ? "synced" : undefined;
  };

  const Image = <K extends keyof ImageFields>({
    name,
    children,
  }: {
    name: K;
    children: (props: ImageRenderProps, data: ImageValue) => React.ReactNode;
  }): React.ReactNode => {
    const selectTarget = usePreviewSelection();
    const blockContext = React.use(Context);
    if (!blockContext) {
      throw new Error("Image must be used within a Block Component");
    }

    const { blockId, content, mode } = blockContext;
    const isContentEditable = useIsEditable(mode);
    const { window: iframeWindow } = useFrame();
    const repeaterContext = React.use(RepeatableItemContext);
    const { filesMap } = useNormalizedData();
    const rawSource = repeaterContext ? repeaterContext.itemContent[name] : content[name];
    // Resolve _fileId markers to full file objects
    const rawValue = resolveAssetValue(rawSource, filesMap) as ImageValue | null;
    const defaultValue = repeaterContext
      ? repeatableItemDefaults[repeaterContext.arrayFieldName]?.[String(name)]
      : contentDefaults[String(name)];
    const fieldValue = rawValue ?? (defaultValue as ImageValue);

    // When wrapped by ImageList/FileList, attribute hover/focus/selection to the
    // enclosing array field on the nearest DB item — the inner `name` here is
    // a synthetic sentinel and not addressable via the schema.
    const isInlineArrayItem = repeaterContext != null && repeaterContext.itemId == null;
    const overlayFieldName = isInlineArrayItem ? repeaterContext.arrayFieldName : String(name);
    const overlayItemId = isInlineArrayItem
      ? repeaterContext.containerItemId
      : repeaterContext?.itemId;

    // Inside a placed record, the image is a record field of that placement.
    const reference = React.use(ReferenceContext);
    const fieldId = getOverlayFieldId(blockId, overlayFieldName, {
      itemId: overlayItemId,
      reference,
    });

    const [isHovered, setIsHovered] = React.useState(false);

    // Derive selected state from selection
    const isBlockFieldSelected = useFieldSelection(
      blockId,
      overlayFieldName,
      "Image",
      overlayItemId,
    );
    const isRecordFieldSelected = useRecordSelection(
      reference?.placement ?? null,
      overlayFieldName,
    );
    const isFocused = reference ? isRecordFieldSelected : isBlockFieldSelected;
    const overlayState = useOverlayState(isHovered, isFocused);

    // Keep sidebar hover via postMessage (transient state)
    const isHoveredFromSidebar = useOverlayMessage(
      iframeWindow,
      isContentEditable,
      "CAMOX_HOVER_FIELD",
      "CAMOX_HOVER_FIELD_END",
      { fieldId },
    );

    React.useEffect(() => {
      setIsHovered(isHoveredFromSidebar);
    }, [isHoveredFromSidebar]);

    const handleClick = (event: React.MouseEvent<HTMLElement>) => {
      if (!isContentEditable) return;
      if (reference) {
        reference.selectRecordField(
          overlayFieldName,
          isInlineArrayItem ? "ImageList" : "Image",
          event,
        );
        return;
      }
      selectTarget(
        overlayItemId != null
          ? {
              type: "item-field",
              blockId,
              itemId: overlayItemId,
              fieldName: overlayFieldName,
              fieldType: "Image",
            }
          : { type: "block-field", blockId, fieldName: overlayFieldName, fieldType: "Image" },
        event,
      );
    };

    const imageProps = {
      src: transformImageUrl(fieldValue.url, {
        width: getDefaultImageWidth(),
        mimeType: fieldValue.mimeType,
        size: fieldValue.size,
      }),
      srcSet: buildImageSrcSet(fieldValue.url, fieldValue.mimeType, fieldValue.size),
      sizes: getDefaultImageSizes(),
      alt: fieldValue.alt,
    } satisfies ImageRenderProps;

    const renderedImage = renderImagePlaceholder(fieldValue, children(imageProps, fieldValue));
    if (!isContentEditable) {
      return <>{renderedImage}</>;
    }

    return (
      <div
        data-camox-field-id={fieldId}
        data-camox-field-type="image"
        {...overlayState}
        data-camox-overlay-mode={assetOverlayMode(reference)}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onClickCapture={handleClick}
      >
        {renderedImage}
      </div>
    );
  };

  const File = <K extends keyof FileFields>({
    name,
    children,
  }: {
    name: K;
    children: (props: FileRenderProps, data: FileValue) => React.ReactNode;
  }): React.ReactNode => {
    const blockContext = React.use(Context);
    if (!blockContext) {
      throw new Error("File must be used within a Block Component");
    }

    const { blockId, content, mode } = blockContext;
    const isContentEditable = useIsEditable(mode);
    const { window: iframeWindow } = useFrame();
    const repeaterContext = React.use(RepeatableItemContext);
    const reference = React.use(ReferenceContext);
    const { filesMap } = useNormalizedData();
    const rawSource = repeaterContext ? repeaterContext.itemContent[name] : content[name];
    // Resolve _fileId markers to full file objects
    const rawValue = resolveAssetValue(rawSource, filesMap) as FileValue | null;
    const defaultValue = repeaterContext
      ? repeatableItemDefaults[repeaterContext.arrayFieldName]?.[String(name)]
      : contentDefaults[String(name)];
    const fieldValue = rawValue ?? (defaultValue as FileValue);

    // Only record files are selectable: they have no other way into their record field view.
    const isInlineArrayItem = repeaterContext != null && repeaterContext.itemId == null;
    const overlayFieldName = isInlineArrayItem ? repeaterContext.arrayFieldName : String(name);
    const fieldId = getOverlayFieldId(blockId, overlayFieldName, { reference });
    const selectable = reference != null && isContentEditable;
    const [isHovered, setIsHovered] = React.useState(false);
    const isFocused = useRecordSelection(reference?.placement ?? null, overlayFieldName);
    const overlayState = useOverlayState(isHovered, isFocused);
    const isHoveredFromSidebar = useOverlayMessage(
      iframeWindow,
      selectable,
      "CAMOX_HOVER_FIELD",
      "CAMOX_HOVER_FIELD_END",
      { fieldId },
    );

    React.useEffect(() => {
      setIsHovered(isHoveredFromSidebar);
    }, [isHoveredFromSidebar]);

    const linkProps: FileRenderProps = { href: fieldValue.url, download: fieldValue.filename };
    // The selectable file is the site's own link: no wrapper element changes its layout.
    const editableLinkProps: EditableFileLinkProps | null = selectable
      ? {
          "data-camox-field-id": fieldId,
          "data-camox-field-type": "file",
          ...overlayState,
          "data-camox-overlay-mode": assetOverlayMode(reference),
          onMouseEnter: () => setIsHovered(true),
          onMouseLeave: () => setIsHovered(false),
          onClickCapture: (event) =>
            reference.selectRecordField(
              overlayFieldName,
              isInlineArrayItem ? "FileList" : "File",
              event,
            ),
          // Selecting a file in the editor must not follow its download link.
          onClick: (event) => event.preventDefault(),
        }
      : null;

    return <>{children({ ...linkProps, ...editableLinkProps }, fieldValue)}</>;
  };

  // Sentinel key used by ImageList/FileList to surface the iterated asset value to
  // the inner Image/File component via a synthesized RepeatableItemContext. Not
  // a valid TypeBox property name, so it can't collide with a real field.
  const ASSET_LIST_SELF_KEY = "__camox_asset_self__";

  const _AssetList = ({
    name,
    children,
  }: {
    name: string;
    children: (props: any, data: any) => React.ReactNode;
  }): React.ReactNode => {
    const blockContext = React.use(Context);
    if (!blockContext) {
      throw new Error("ImageList/FileList must be used within a Block Component");
    }

    const parentRepeaterContext = React.use(RepeatableItemContext);
    const { filesMap } = useNormalizedData();
    const fieldName = String(name);

    const fieldSchema = parentRepeaterContext
      ? (typeboxSchema.properties as any)[parentRepeaterContext.arrayFieldName]?.items
          ?.properties?.[fieldName]
      : (blockContext.sourceSchema ?? typeboxSchema.properties)[fieldName];
    const ft = fieldSchema?.fieldType as "ImageList" | "FileList" | undefined;
    if (ft !== "ImageList" && ft !== "FileList") {
      throw new Error(`"${fieldName}" is not a Type.ImageList or Type.FileList field`);
    }

    const source = parentRepeaterContext
      ? parentRepeaterContext.itemContent[fieldName]
      : (blockContext.content as Record<string, unknown>)[fieldName];

    // No stored items — synthesize `defaultItems` preview placeholders from the
    // leaf default. These are render-only (never persisted) and apply equally
    // to peek and site modes so empty galleries don't render as blank in the
    // editor preview.
    let arr: unknown[] = Array.isArray(source) ? source : [];
    if (arr.length === 0) {
      const defaultCount = (fieldSchema.defaultItems ?? 0) as number;
      const itemDefault = fieldSchema.items?.default;
      if (defaultCount > 0 && itemDefault) {
        arr = Array.from({ length: defaultCount }, () => itemDefault);
      }
    }

    // Resolve _fileId markers and skip nullish (e.g. markers pointing to deleted files).
    const resolved = arr
      .map((v) => resolveAssetValue(v, filesMap))
      .filter(
        (v): v is ImageValue | FileValue =>
          v != null && typeof v === "object" && "url" in (v as object),
      );

    const Single = (ft === "ImageList" ? Image : File) as (props: {
      name: any;
      children: (props: any, data: any) => React.ReactNode;
    }) => React.ReactNode;

    return (
      <RepeaterHoverProvider blockId={blockContext.blockId} fieldName={fieldName}>
        {resolved.map((value, index) => (
          <RepeatableItemContext.Provider
            key={index}
            value={{
              arrayFieldName: fieldName,
              itemIndex: index,
              itemContent: { [ASSET_LIST_SELF_KEY]: value },
              itemSettings: {},
              itemId: undefined,
              containerItemId:
                parentRepeaterContext?.itemId ?? parentRepeaterContext?.containerItemId,
            }}
          >
            <Single name={ASSET_LIST_SELF_KEY}>{children}</Single>
          </RepeatableItemContext.Provider>
        ))}
      </RepeaterHoverProvider>
    );
  };

  const ImageList = _AssetList as <K extends keyof ImageListFields>(props: {
    name: K;
    children: (props: ImageRenderProps, data: ImageValue) => React.ReactNode;
  }) => React.ReactNode;

  const FileList = _AssetList as <K extends keyof FileListFields>(props: {
    name: K;
    children: (props: FileRenderProps, data: FileValue) => React.ReactNode;
  }) => React.ReactNode;

  // RepeatableItemWrapper - wraps each repeatable item with overlay support
  const RepeatableItemWrapper = ({
    itemId,
    blockId,
    mode,
    children,
  }: {
    itemId: number | undefined;
    blockId: number;
    mode: "site" | "peek" | "layout";
    children: React.ReactNode;
  }) => {
    const isContentEditable = useIsEditable(mode);
    const { window: iframeWindow } = useFrame();

    const selectTarget = usePreviewSelection();
    const isCommentMode = useSelector(previewStore, selectIsCommentMode);
    const [isLocallyHovered, setIsLocallyHovered] = React.useState(false);

    // Check if the parent repeater container is being hovered from sidebar
    const hoveredRepeaterGroup = React.useContext(RepeaterHoverContext);

    const selection = usePreviewTargetSelection();
    const isSelected =
      selection?.type === "item" && selection.blockId === blockId && selection.itemId === itemId;

    const isHovered = useOverlayMessage(
      iframeWindow,
      isContentEditable,
      "CAMOX_HOVER_REPEATABLE_ITEM",
      "CAMOX_HOVER_REPEATABLE_ITEM_END",
      { blockId: String(blockId), itemId: String(itemId) },
    );

    const overlayState = useOverlayState(
      isHovered || hoveredRepeaterGroup !== null || isLocallyHovered,
      isSelected,
    );

    const handleClick = (event: React.MouseEvent) => {
      if (!isContentEditable || !isCommentMode || itemId == null) return;
      const target = event.target as HTMLElement;
      if (target.closest("[data-camox-field-id]")) return;
      if (
        target.closest(
          "[data-camox-repeatable-item-id], [data-camox-block-id], [data-camox-comment-block-id]",
        ) !== event.currentTarget
      )
        return;
      selectTarget({ type: "item", blockId, itemId }, event);
    };

    return (
      <div
        data-camox-repeatable-item-id={isContentEditable ? itemId : undefined}
        data-camox-hover-group={isContentEditable ? hoveredRepeaterGroup : undefined}
        onClickCapture={handleClick}
        onMouseEnter={() => setIsLocallyHovered(true)}
        onMouseLeave={() => setIsLocallyHovered(false)}
        {...(isContentEditable ? overlayState : {})}
        data-camox-overlay-mode={options.synced ? "synced" : undefined}
      >
        {children}
      </div>
    );
  };

  // RepeaterHoverProvider - provides hover state to child items without adding DOM elements
  const RepeaterHoverProvider = ({
    blockId,
    fieldName,
    children,
  }: {
    blockId: number;
    fieldName: string;
    children: React.ReactNode;
  }) => {
    const isContentEditable = useIsEditable("site");
    const { window: iframeWindow } = useFrame();
    const hoverGroup = React.useId();

    const isHovered = useOverlayMessage(
      iframeWindow,
      isContentEditable,
      "CAMOX_HOVER_REPEATER",
      "CAMOX_HOVER_REPEATER_END",
      { blockId: String(blockId), fieldName },
    );

    return (
      <RepeaterHoverContext.Provider value={isHovered ? hoverGroup : null}>
        {children}
      </RepeaterHoverContext.Provider>
    );
  };

  const Repeater = <K extends keyof RepeatableFields>({
    name,
    children,
  }: {
    name: K;
    children: (
      item: {
        Field: <F extends keyof ItemStringFields<K>>(
          props: InlineTextStyles & {
            name: F;
            children: (props: FieldRenderProps, data: FieldRenderData) => React.ReactNode;
          },
        ) => React.ReactNode;
        Link: <F extends keyof ItemLinkFields<K>>(props: {
          name: F;
          children: (props: LinkRenderProps, data: LinkRenderData) => React.ReactNode;
        }) => React.ReactNode;
        Icon: (props: IconProps & { name: keyof ItemIconFields<K> }) => React.ReactNode;
        Embed: <F extends keyof ItemEmbedFields<K>>(props: {
          name: F;
          children: (props: EmbedRenderProps, data: EmbedRenderData) => React.ReactNode;
        }) => React.ReactNode;
        Image: <F extends keyof ItemImageFields<K>>(props: {
          name: F;
          children: (props: ImageRenderProps, data: ImageValue) => React.ReactNode;
        }) => React.ReactNode;
        File: <F extends keyof ItemFileFields<K>>(props: {
          name: F;
          children: (props: FileRenderProps, data: FileValue) => React.ReactNode;
        }) => React.ReactNode;
        ImageList: <F extends keyof ItemImageListFields<K>>(props: {
          name: F;
          children: (props: ImageRenderProps, data: ImageValue) => React.ReactNode;
        }) => React.ReactNode;
        FileList: <F extends keyof ItemFileListFields<K>>(props: {
          name: F;
          children: (props: FileRenderProps, data: FileValue) => React.ReactNode;
        }) => React.ReactNode;
        Repeater: <F extends keyof ItemRepeatableFields<K>>(props: {
          name: F;
          children: (
            item: {
              Field: (
                props: InlineTextStyles & {
                  name: string;
                  children: (props: FieldRenderProps, data: FieldRenderData) => React.ReactNode;
                },
              ) => React.ReactNode;
              Link: (props: {
                name: string;
                children: (props: LinkRenderProps, data: LinkRenderData) => React.ReactNode;
              }) => React.ReactNode;
              Icon: (props: IconProps & { name: string }) => React.ReactNode;
              Embed: (props: {
                name: string;
                children: (props: EmbedRenderProps, data: EmbedRenderData) => React.ReactNode;
              }) => React.ReactNode;
              Image: (props: {
                name: string;
                children: (props: ImageRenderProps, data: ImageValue) => React.ReactNode;
              }) => React.ReactNode;
              File: (props: {
                name: string;
                children: (props: FileRenderProps, data: FileValue) => React.ReactNode;
              }) => React.ReactNode;
              ImageList: (props: {
                name: string;
                children: (props: ImageRenderProps, data: ImageValue) => React.ReactNode;
              }) => React.ReactNode;
              FileList: (props: {
                name: string;
                children: (props: FileRenderProps, data: FileValue) => React.ReactNode;
              }) => React.ReactNode;
              Repeater: (props: {
                name: string;
                children: (item: any, index: number) => React.ReactNode;
              }) => React.ReactNode;
              useSetting: (name: string) => unknown;
            },
            index: number,
          ) => React.ReactNode;
        }) => React.ReactNode;
        useSetting: <F extends keyof ItemSettingsStatic<K>>(name: F) => ItemSettingsStatic<K>[F];
      },
      index: number,
    ) => React.ReactNode;
  }) => {
    const blockContext = React.use(Context);
    if (!blockContext) {
      throw new Error("Repeater must be used within a Block Component");
    }

    const { blockId, content, mode } = blockContext;

    // Check if we're inside another repeater (nested)
    const parentRepeaterContext = React.use(RepeatableItemContext);
    const fieldName = String(name);

    // Type-cast components to work with item fields
    // This is safe because each component checks RepeatableItemContext at runtime
    const ItemField = Field as <F extends keyof ItemStringFields<K>>(props: {
      name: F;
      children: (props: FieldRenderProps, data: FieldRenderData) => React.ReactNode;
    }) => React.ReactNode;

    const ItemLink = Link as <F extends keyof ItemLinkFields<K>>(props: {
      name: F;
      children: (props: LinkRenderProps, data: LinkRenderData) => React.ReactNode;
    }) => React.ReactNode;

    const ItemEmbed = Embed as <F extends keyof ItemEmbedFields<K>>(props: {
      name: F;
      children: (props: EmbedRenderProps, data: EmbedRenderData) => React.ReactNode;
    }) => React.ReactNode;

    const ItemImage = Image as <F extends keyof ItemImageFields<K>>(props: {
      name: F;
      children: (props: ImageRenderProps, data: ImageValue) => React.ReactNode;
    }) => React.ReactNode;

    const ItemImageList = _AssetList as <F extends keyof ItemImageListFields<K>>(props: {
      name: F;
      children: (props: ImageRenderProps, data: ImageValue) => React.ReactNode;
    }) => React.ReactNode;

    const ItemFileList = _AssetList as <F extends keyof ItemFileListFields<K>>(props: {
      name: F;
      children: (props: FileRenderProps, data: FileValue) => React.ReactNode;
    }) => React.ReactNode;

    const ItemFile = File as <F extends keyof ItemFileFields<K>>(props: {
      name: F;
      children: (props: FileRenderProps, data: FileValue) => React.ReactNode;
    }) => React.ReactNode;

    const ItemRepeater = Repeater as <F extends keyof ItemRepeatableFields<K>>(props: {
      name: F;
      children: (
        item: {
          Field: (props: {
            name: string;
            children: (props: FieldRenderProps, data: FieldRenderData) => React.ReactNode;
          }) => React.ReactNode;
          Link: (props: {
            name: string;
            children: (props: LinkRenderProps, data: LinkRenderData) => React.ReactNode;
          }) => React.ReactNode;
          Icon: (props: IconProps & { name: string }) => React.ReactNode;
          Embed: (props: {
            name: string;
            children: (props: EmbedRenderProps, data: EmbedRenderData) => React.ReactNode;
          }) => React.ReactNode;
          Image: (props: {
            name: string;
            children: (props: ImageRenderProps, data: ImageValue) => React.ReactNode;
          }) => React.ReactNode;
          File: (props: {
            name: string;
            children: (props: FileRenderProps, data: FileValue) => React.ReactNode;
          }) => React.ReactNode;
          ImageList: (props: {
            name: string;
            children: (props: ImageRenderProps, data: ImageValue) => React.ReactNode;
          }) => React.ReactNode;
          FileList: (props: {
            name: string;
            children: (props: FileRenderProps, data: FileValue) => React.ReactNode;
          }) => React.ReactNode;
          Repeater: (props: {
            name: string;
            children: (item: any, index: number) => React.ReactNode;
          }) => React.ReactNode;
          useSetting: (name: string) => unknown;
        },
        index: number,
      ) => React.ReactNode;
    }) => React.ReactNode;

    // Items come from either the parent repeater context (nested) or block content (top-level)
    const source = parentRepeaterContext ? parentRepeaterContext.itemContent[name] : content[name];
    const { itemsMap } = useNormalizedData();
    let arrayValue = (source ?? []) as any[];

    if (!Array.isArray(arrayValue)) {
      throw new Error(`Field "${String(name)}" is not an array`);
    }

    // Resolve _itemId markers to full item objects from the normalized data
    arrayValue = arrayValue
      .map((item: any) => {
        if (isItemMarker(item)) {
          return itemsMap.get(item._itemId) ?? null;
        }
        return item;
      })
      .filter(Boolean);

    type TItem = RepeatableItemType<K>;

    const settingsDefaultsForField = repeatableItemSettingsDefaults[fieldName];

    return (
      <RepeaterHoverProvider blockId={blockId} fieldName={fieldName}>
        {arrayValue.map((item: any, index: number) => {
          // DB-backed items have { id, content, ... }; inline items are plain objects
          const isDbItem = item.content !== undefined && item.id != null;
          const itemContent = {
            ...repeatableItemDefaults[fieldName],
            ...(isDbItem ? item.content : item),
          } as TItem;
          const itemSettings: Record<string, unknown> = {
            ...settingsDefaultsForField,
            ...(isDbItem ? (item.settings as Record<string, unknown> | null) : null),
          };
          const itemId: number | undefined = isDbItem ? item.id : undefined;
          const useItemSetting = (settingName: string) => itemSettings[settingName];

          const itemApi = {
            Field: ItemField,
            Link: ItemLink,
            Icon: Icon as (props: IconProps & { name: keyof ItemIconFields<K> }) => React.ReactNode,
            Embed: ItemEmbed,
            Image: ItemImage,
            File: ItemFile,
            ImageList: ItemImageList,
            FileList: ItemFileList,
            Repeater: ItemRepeater,
            useSetting: useItemSetting as <F extends keyof ItemSettingsStatic<K>>(
              name: F,
            ) => ItemSettingsStatic<K>[F],
          };

          return (
            <RepeatableItemContext.Provider
              key={itemId ?? index}
              value={{
                arrayFieldName: fieldName,
                itemIndex: index,
                itemContent: itemContent,
                itemSettings,
                itemId: itemId,
                containerItemId: itemId ?? parentRepeaterContext?.containerItemId,
              }}
            >
              <RepeatableItemWrapper itemId={itemId} blockId={blockId} mode={mode}>
                {children(itemApi, index)}
              </RepeatableItemWrapper>
            </RepeatableItemContext.Provider>
          );
        })}
      </RepeaterHoverProvider>
    );
  };

  const BlockComponent = ({
    blockData,
    mode,
    isFirstBlock,
    showAddBlockTop,
    showAddBlockBottom,
    addBlockAfterPosition,
  }: BlockComponentProps<TContent>) => {
    const isContentEditable = useIsEditable(mode);
    const { window: iframeWindow } = useFrame();

    // Local state for hover
    const [isHovered, setIsHovered] = React.useState(false);
    const isCommentMode = useSelector(previewStore, selectIsCommentMode);

    // Scroll into view when editing in preview
    const selection = usePreviewTargetSelection();
    const selectTarget = usePreviewSelection();
    const isBlockSelected = selection?.blockId === blockData._id;
    const overlayState = useOverlayState(isHovered, isBlockSelected);
    const ref = React.useRef<HTMLDivElement>(null);

    // Track first render because we won't animate the scroll into view for it
    const [isFirstRender, setIsFirstRender] = React.useState(true);
    React.useEffect(() => {
      if (isFirstRender) {
        setIsFirstRender(false);
      }
    }, [isFirstRender]);

    // Scroll block into view when selected
    React.useEffect(() => {
      if (!isBlockSelected || !ref.current) return;

      ref.current.scrollIntoView({
        behavior: isFirstRender ? "instant" : "smooth",
        block: isFirstRender ? "start" : "nearest",
      });
    }, [blockData._id, isBlockSelected, isFirstRender]);

    // Listen for sidebar-triggered hover messages
    const isHoveredFromSidebar = useOverlayMessage(
      iframeWindow,
      isContentEditable,
      "CAMOX_HOVER_BLOCK",
      "CAMOX_HOVER_BLOCK_END",
      { blockId: String(blockData._id) },
    );

    React.useEffect(() => {
      setIsHovered(isHoveredFromSidebar);
    }, [isHoveredFromSidebar]);

    // Normalize content: keep full item objects for internal use, but prepare content-only version for display
    // We need to keep blockData.content as-is because Repeater needs the full objects with _id
    // But we also need to pass to options.component for the content prop (used in non-Repeater contexts)
    const normalizedContent = React.useMemo(() => {
      const result = { ...blockData.content } as any;

      // Transform array fields from full item objects to content-only for the component prop
      for (const key in result) {
        const value = result[key];
        if (Array.isArray(value) && value.length > 0 && value[0]?.content !== undefined) {
          // Extract just the content for the component prop
          result[key] = value.map((item: any) => item.content);
        }
      }

      return result as TContent;
    }, [blockData.content]);

    const handleClick = (e: React.MouseEvent) => {
      if (!isContentEditable) return;

      // Let fields and commentable items handle their own clicks.
      const target = e.target as HTMLElement;
      if (target.closest("[data-camox-field-id]")) return;
      if (isCommentMode && target.closest("[data-camox-repeatable-item-id]")) return;

      if (
        target.closest("[data-camox-block-id], [data-camox-comment-block-id]") !== e.currentTarget
      )
        return;
      selectTarget({ type: "block", blockId: blockData._id }, e);
    };

    const handleMouseEnter = () => {
      if (!isContentEditable) return;
      setIsHovered(true);
    };

    const handleMouseLeave = () => {
      if (!isContentEditable) return;
      setIsHovered(false);
    };

    // The bright colors overlays to show selection and editable content
    const shouldShowOverlay =
      isContentEditable &&
      (overlayState["data-camox-hovered"] || overlayState["data-camox-focused"]);

    return (
      <div
        className="group visual-editing-block"
        data-camox-viewport-block={blockData._id}
        ref={ref}
        style={{
          position: "relative",
          scrollMargin: "5rem",
          background: "var(--background)",
        }}
        data-camox-block-id={isContentEditable ? blockData._id : undefined}
        data-camox-block-insertion={
          isContentEditable
            ? JSON.stringify({
                position: blockData.position,
                before: showAddBlockTop ?? (mode !== "layout" && !isFirstBlock),
                after: showAddBlockBottom ?? mode !== "layout",
                ...(addBlockAfterPosition !== undefined
                  ? { afterPosition: addBlockAfterPosition }
                  : {}),
              })
            : undefined
        }
        {...(shouldShowOverlay ? overlayState : {})}
        data-camox-overlay-mode={options.synced ? "synced" : undefined}
        onClickCapture={handleClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <Context.Provider
          value={{
            blockId: blockData._id,
            content: (() => {
              const merged = { ...contentDefaults, ...blockData.content };
              const overrides: Record<string, unknown> = {};
              for (const key in merged) {
                const val = (merged as Record<string, unknown>)[key];
                if (
                  val &&
                  typeof val === "object" &&
                  "url" in val &&
                  !(val as any).url &&
                  contentDefaults[key]
                ) {
                  overrides[key] = contentDefaults[key];
                }
              }
              return { ...merged, ...overrides };
            })(),
            settings: {
              ...settingsDefaults,
              ...blockData.settings,
            } as TSettings,
            mode,
            isHovered,
            setIsHovered,
          }}
        >
          <options.component content={normalizedContent} />
        </Context.Provider>
      </div>
    );
  };

  const useSetting = <K extends keyof TSettings>(name: K): TSettings[K] => {
    const ctx = React.use(Context);
    if (!ctx) {
      throw new Error("useSetting must be used within a Block Component");
    }
    return ctx.settings[name];
  };

  // Record assets and embeds select their record field (edited in the sidebar record field
  // view); they never expose a block-field mutation or picker.
  const ReferencePrimitive = ({
    primitive: Primitive,
    ...props
  }: {
    primitive: React.ComponentType<any>;
    name: string;
    children: any;
  }) => {
    const block = React.use(Context)!;
    if ((block.content as Record<string, unknown>)[props.name] == null) return null;
    return <Primitive {...props} />;
  };
  const ReferenceImage = (props: any) => <ReferencePrimitive primitive={Image} {...props} />;
  const ReferenceFile = (props: any) => <ReferencePrimitive primitive={File} {...props} />;
  const ReferenceEmbed = (props: any) => <ReferencePrimitive primitive={Embed} {...props} />;
  const ReferenceImageList = (props: any) => (
    <ReferencePrimitive primitive={ImageList} {...props} />
  );
  const ReferenceFileList = (props: any) => <ReferencePrimitive primitive={FileList} {...props} />;

  const Reference = <K extends ReferenceKeys<TSchemaShape>>({
    name,
    children,
  }: {
    name: K;
    children: (scope: ReferenceScope<ReferenceContent<TSchemaShape[K]>>) => React.ReactNode;
  }): React.ReactNode => {
    const block = React.use(Context);
    const { recordsMap } = useNormalizedData();
    const camoxApp = useOptionalCamoxApp();
    const selectTarget = usePreviewSelection();
    const projectSlug = useProjectSlug();
    const queryClient = useQueryClient();
    const mutation = useMutation(collectionMutations.edit());
    const [error, setError] = React.useState<string | null>(null);
    const [hovered, setHovered] = React.useState(false);
    if (!block) throw new Error("Reference must be used within a Block Component");
    const editable = useIsEditable(block.mode);
    const fieldName = String(name);
    const schema = typeboxSchema.properties[fieldName];
    const collectionTitle =
      camoxApp?.getCollectionById(schema.collectionId)?._internal.title ??
      schema.title ??
      fieldName;
    const record = resolveReference(
      (block.content as Record<string, unknown>)[fieldName],
      schema.collectionId,
      recordsMap,
    );
    const occurrenceId = referenceOccurrenceId(block.blockId, fieldName);
    const placement = record ? { blockId: block.blockId, fieldName, recordId: record.id } : null;
    const referenceSelected = useFieldSelection(block.blockId, fieldName, "Reference");
    const recordSelected = useRecordSelection(placement);
    const { window: iframeWindow } = useFrame();
    const sidebarHovered = useOverlayMessage(
      iframeWindow,
      editable,
      "CAMOX_HOVER_FIELD",
      "CAMOX_HOVER_FIELD_END",
      { fieldId: occurrenceId },
    );
    const overlay = useOverlayState(hovered || sidebarHovered, referenceSelected || recordSelected);
    const selectReferenceField = (event?: React.MouseEvent<HTMLElement>) => {
      if (!editable) return;
      selectTarget(
        {
          type: "block-field",
          blockId: block.blockId,
          fieldName,
          fieldType: "Reference",
        },
        event,
      );
    };
    // Record fields select themselves; any other click inside the placement selects the record.
    const selectRecord = (event: React.MouseEvent<HTMLElement>) => {
      if (!editable || !placement) return;
      const target = event.target as HTMLElement;
      if (target.closest("[data-camox-field-id]") !== event.currentTarget) return;
      selectTarget({ type: "record", ...placement }, event);
    };
    const selectRecordField = (
      recordFieldName: string,
      recordFieldType: FieldType,
      event?: SelectionEvent,
    ) => {
      if (!editable || !placement) return;
      selectTarget({ type: "record-field", ...placement, recordFieldName, recordFieldType }, event);
    };
    const update = (field: string, value: string) => {
      if (!record || !editable) return;
      setError(null);
      void referenceWritesFor(queryClient)
        .save(record, field, value, async (input) => {
          const saved = await mutation.mutateAsync({ ...input, projectSlug });
          queryClient.setQueryData(
            collectionQueries.record(projectSlug, record.collectionId, record.id).queryKey,
            saved,
          );
          // Shared source changes must refresh every occurrence, not only this block.
          void invalidateCollectionRecordViews(queryClient, projectSlug, record.collectionId);
          return saved;
        })
        .catch((cause: unknown) => {
          setError(cause instanceof Error ? cause.message : "Could not save item");
        });
    };
    if (!record && !editable) return null;
    const rendered =
      record && placement ? (
        <ReferenceContext.Provider value={{ placement, selectRecordField, update }}>
          <RepeatableItemContext.Provider value={null}>
            <Context.Provider
              value={{
                ...block,
                content: record.content as TContent,
                sourceSchema: schema.referenceSchema.properties,
              }}
            >
              {children({
                id: record.id,
                label: record.label,
                Field,
                Image: ReferenceImage,
                File: ReferenceFile,
                Embed: ReferenceEmbed,
                ImageList: ReferenceImageList,
                FileList: ReferenceFileList,
              } as unknown as ReferenceScope<ReferenceContent<TSchemaShape[K]>>)}
            </Context.Provider>
          </RepeatableItemContext.Provider>
        </ReferenceContext.Provider>
      ) : (
        <button
          type="button"
          data-camox-reference-placeholder=""
          className="camox-reference-placeholder"
          onClick={(event) => {
            selectReferenceField(event);
            // Commenting targets the field; only editing links a record.
            if (selectIsCommentMode(previewStore.getSnapshot())) return;
            referencePickerFocus.send({ type: "request", fieldId: occurrenceId });
          }}
        >
          Select {collectionTitle}
        </button>
      );
    if (!editable) return rendered;
    return (
      <div
        data-camox-field-id={occurrenceId}
        data-camox-collection-record-id={record?.id}
        data-camox-reference-label={record?.label}
        data-camox-overlay-mode="reference"
        {...overlay}
        onClickCapture={selectRecord}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {rendered}
        {error && <p role="alert">Could not save item. {error}</p>}
      </div>
    );
  };

  // Listed records render in place, but are not selectable or inline-editable yet:
  // their primitives render as on the live site (`peek` is never editable).
  const ReferenceList = <K extends ReferenceListKeys<TSchemaShape>>({
    name,
    children,
  }: {
    name: K;
    children: (scope: ReferenceScope<ReferenceContent<TSchemaShape[K]>>) => React.ReactNode;
  }): React.ReactNode => {
    const block = React.use(Context);
    const { recordsMap } = useNormalizedData();
    if (!block) throw new Error("ReferenceList must be used within a Block Component");
    const fieldName = String(name);
    const schema = typeboxSchema.properties[fieldName];
    const records = resolveReferenceList(
      (block.content as Record<string, unknown>)[fieldName],
      schema.collectionId,
      recordsMap,
    );
    return records.map((record) => (
      <ReferenceContext.Provider key={record.id} value={null}>
        <RepeatableItemContext.Provider value={null}>
          <Context.Provider
            value={{
              ...block,
              mode: "peek",
              content: record.content as TContent,
              sourceSchema: schema.referenceSchema.properties,
            }}
          >
            {children({
              id: record.id,
              label: record.label,
              Field,
              Image: ReferenceImage,
              File: ReferenceFile,
              Embed: ReferenceEmbed,
              ImageList: ReferenceImageList,
              FileList: ReferenceFileList,
            } as unknown as ReferenceScope<ReferenceContent<TSchemaShape[K]>>)}
          </Context.Provider>
        </RepeatableItemContext.Provider>
      </ReferenceContext.Provider>
    ));
  };

  /**
   * Wraps block content that renders outside the block's visual bounds (fixed navbars, modals, portals, etc.).
   * Provides the same hover and selection overlays as the main BlockComponent.
   */
  const Detached = ({
    children,
  }: {
    children: (props: DetachedRenderProps) => React.ReactNode;
  }): React.JSX.Element => {
    const ctx = React.use(Context);
    if (!ctx) {
      throw new Error("Detached must be used within a Block Component");
    }
    const { blockId, mode, isHovered, setIsHovered } = ctx;

    const isContentEditable = useIsEditable(mode);
    const { window: iframeWindow } = useFrame();

    const selection = usePreviewTargetSelection();
    const selectTarget = usePreviewSelection();
    const isBlockSelected = selection?.blockId === blockId;
    const overlayState = useOverlayState(isHovered, isBlockSelected);

    const isHoveredFromSidebar = useOverlayMessage(
      iframeWindow,
      isContentEditable,
      "CAMOX_HOVER_BLOCK",
      "CAMOX_HOVER_BLOCK_END",
      { blockId: String(blockId) },
    );

    React.useEffect(() => {
      setIsHovered(isHoveredFromSidebar);
    }, [isHoveredFromSidebar, setIsHovered]);

    const shouldShowOverlay =
      isContentEditable &&
      (overlayState["data-camox-hovered"] || overlayState["data-camox-focused"]);

    const handleClick = (e: React.MouseEvent) => {
      if (!isContentEditable) return;
      const target = e.target as HTMLElement;
      if (target.closest("[data-camox-field-id]")) return;
      if (
        selectIsCommentMode(previewStore.getSnapshot()) &&
        target.closest("[data-camox-repeatable-item-id]")
      )
        return;
      if (
        target.closest("[data-camox-block-id], [data-camox-comment-block-id]") !== e.currentTarget
      )
        return;
      selectTarget({ type: "block", blockId }, e);
    };

    const handleMouseEnter = () => {
      if (isContentEditable) {
        setIsHovered(true);
      }
    };

    const handleMouseLeave = () => {
      if (isContentEditable) {
        setIsHovered(false);
      }
    };

    return (
      <>
        {children({
          "data-camox-block-id": isContentEditable ? blockId : undefined,
          ...(shouldShowOverlay ? overlayState : {}),
          "data-camox-overlay-mode": options.synced ? "synced" : undefined,
          onClickCapture: handleClick,
          onMouseEnter: handleMouseEnter,
          onMouseLeave: handleMouseLeave,
        } satisfies DetachedRenderProps)}
      </>
    );
  };

  return {
    Detached,
    Icon,
    Field,
    Embed,
    Link,
    Image,
    File,
    ImageList,
    FileList,
    Repeater,
    Reference,
    ReferenceList,
    useSetting,
    _internal: {
      /**
       * The react component to be used at the page level when mapping on blocks content.
       * It exposes context that will be consumed by the Field component, and provides visual editing
       * capabilities (e.g. delete and reorder blocks).
       */
      Component: BlockComponent,
      id: options.id,
      title: options.title,
      description: options.description,
      contentSchema,
      settingsSchema,
      layoutOnly: (options.layoutOnly ?? false) as TLayoutOnly,
      synced: options.synced ?? false,
      getInitialBundle: () => {
        const counter = { value: 0 };
        const allSeeds: RepeatableItemSeed[] = [];

        // Build content with _itemId markers for repeatable fields, scalar defaults for the rest
        const content: Record<string, unknown> = { ...contentDefaults };
        buildInitialSeeds(typeboxSchema.properties, null, content, allSeeds, counter);

        // Strip repeatable markers and asset placeholders for storage-safe content
        const storageContent: Record<string, unknown> = {};
        for (const [key, prop] of Object.entries(typeboxSchema.properties)) {
          const ft = (prop as any).fieldType;
          if (
            ft === "Image" ||
            ft === "File" ||
            ft === "ImageList" ||
            ft === "FileList" ||
            ft === "Repeater"
          ) {
            continue;
          }
          if ("default" in prop) {
            storageContent[key] = prop.default;
          }
        }

        return {
          content: storageContent as Record<string, unknown>,
          settings: { ...settingsDefaults },
          repeatableItems: allSeeds,
        };
      },
      getInitialContent: () => {
        return { ...contentDefaultsForStorage } as TContent;
      },
      getInitialSettings: () => {
        return { ...settingsDefaults };
      },
      getPeekBundle: () => {
        const PEEK_BLOCK_ID = -1;
        const counter = { value: 0 };
        const allItems: PeekItem[] = [];

        // Build content with _itemId markers for repeatable fields, scalar defaults for the rest
        const content: Record<string, unknown> = { ...contentDefaults };
        buildPeekItems(typeboxSchema.properties, PEEK_BLOCK_ID, null, content, allItems, counter);

        return {
          block: {
            id: PEEK_BLOCK_ID,
            pageId: null,
            layoutId: null,
            type: options.id,
            content,
            settings: settingsDefaults,
            slot: null,
            summary: "",
            position: "",
            createdAt: 0,
            updatedAt: 0,
          },
          repeatableItems: allItems,
          files: [],
        };
      },
    },
  };
}

export type EditableBlock = ReturnType<typeof createEditableBlock>;
