import { isQueryBacked } from "@camox/api-contract";
import { Type as TypeBoxType } from "@sinclair/typebox";
import { generateKeyBetween } from "fractional-indexing";
import * as React from "react";

import { useLocation, useNavigate } from "../features/navigation/navigation";
import { useOptionalCamoxApp } from "../features/provider/components/CamoxAppContext";
import { useProjectUuid } from "../lib/auth";
import { useLinkPages } from "../lib/link-pages";
import {
  isItemMarker,
  queryResultIds,
  resolveAssetValue,
  useNormalizedData,
} from "../lib/normalized-data";
import { useBlockEditingRuntime } from "./editing/BlockEditingRuntime";
import {
  ArtifactStudioContext,
  ArtifactsRunContext,
  useArtifactHost,
  useInitialArtifactData,
} from "./hooks/useArtifactHost";
import { artifactFrameProps, artifactStandInProps, isArtifactSource } from "./lib/artifact";
import { artifactData } from "./lib/artifactData";
import {
  resolveBlockFields,
  resolveToMarkdown,
  resolveToTitle,
  type FileValue,
  type ImageValue,
  type LinkValue,
} from "./lib/contentType";
import { IconSvg } from "./lib/icons";
import { renderImagePlaceholder } from "./lib/imagePlaceholder";
import {
  buildImageSrcSet,
  getDefaultImageSizes,
  getDefaultImageWidth,
  transformImageUrl,
} from "./lib/imageTransform";
import { markdownToReactNodes } from "./lib/lexicalReact";
import { resolveReference, resolveReferenceList, type ReferenceRecord } from "./lib/reference";

export type {
  BlockComponentProps,
  ContentFieldBuilder,
  SettingBuilder,
  PeekItem,
  RepeatableItemSeed,
} from "./editing/createEditableBlock";
export type {
  InlineStyle,
  InlineTextStyles,
  TextStyleData,
  TextLinkStyleData,
} from "./lib/lexicalReact";

type EditableCreateBlock = typeof import("./editing/createEditableBlock").createEditableBlock;
type EditableOptions = Parameters<EditableCreateBlock>[0];

interface BlockContextValue {
  blockId: string;
  content: Record<string, unknown>;
  sourceSchema?: Record<string, any>;
  /** Inside a placed record: 1 for records the block or an item places, 2 for those they link. */
  recordHop?: 1 | 2;
  settings: Record<string, unknown>;
  mode: "site" | "peek" | "layout";
}

interface RepeaterContextValue {
  arrayFieldName: string;
  containerItemId?: string;
  itemContent: Record<string, unknown>;
  itemId?: string;
  itemSettings: Record<string, unknown>;
  /** The item's field schemas, at any repeater depth. */
  itemSchema?: Record<string, any>;
}

const ASSET_LIST_SELF_KEY = "__camox_asset_self__";

function normalizeLinkValue(value: Record<string, unknown>): LinkValue {
  if (value.type) return value as unknown as LinkValue;
  return { type: "external", ...value } as LinkValue;
}

function resolveLinkHref(
  link: LinkValue,
  pages: Array<{ id: string; fullPath: string }> | undefined,
  pathname: string,
): string | null {
  if (link.type === "page") {
    // Until pages load, the current path stands in; a link to a missing page has no href (ADR 0009).
    if (!pages) return pathname;
    return pages.find((page) => page.id === link.pageId)?.fullPath ?? null;
  }
  if (!link.href || link.href.startsWith("#")) return `${pathname}${link.href ?? ""}`;
  return link.href;
}

function collectDefaults(properties: Record<string, any>) {
  const defaults: Record<string, unknown> = {};
  for (const [key, property] of Object.entries(properties)) {
    if ("default" in property) defaults[key] = property.default;
  }
  return defaults;
}

function buildInitialItems(
  properties: Record<string, any>,
  parentTempId: string | null,
  content: Record<string, unknown>,
  items: Array<Record<string, unknown>>,
  counter: { value: number },
) {
  for (const [fieldName, property] of Object.entries(properties)) {
    if (property.type !== "array" || !property.items?.properties) continue;
    if (property.fieldType === "ImageList" || property.fieldType === "FileList") continue;
    const markers: Array<{ _itemId: string }> = [];
    const defaultCount = Number(property.defaultItems ?? property.minItems ?? 0);
    let previousPosition: string | null = null;
    for (let index = 0; index < defaultCount; index += 1) {
      const tempId = `seed_${++counter.value}`;
      const itemContent: Record<string, unknown> = {};
      for (const [key, itemProperty] of Object.entries(property.items.properties) as Array<
        [string, any]
      >) {
        if (itemProperty.type === "array" && itemProperty.items?.properties) continue;
        if ("default" in itemProperty) itemContent[key] = itemProperty.default;
      }
      const position = generateKeyBetween(previousPosition, null);
      previousPosition = position;
      items.push({
        tempId,
        parentTempId,
        fieldName,
        content: { ...itemContent },
        ...(property.defaultItemSettings && {
          settings: { ...property.defaultItemSettings },
        }),
        position,
      });
      const nestedDiscard: Record<string, unknown> = {};
      buildInitialItems(property.items?.properties ?? {}, tempId, nestedDiscard, items, counter);
      markers.push({ _itemId: tempId });
    }
    content[fieldName] = markers;
  }
}

function buildPeekItems(
  properties: Record<string, any>,
  blockId: string,
  parentItemId: string | null,
  content: Record<string, unknown>,
  items: Array<Record<string, unknown>>,
  counter: { value: number },
) {
  for (const [fieldName, property] of Object.entries(properties)) {
    if (property.type !== "array" || !property.items?.properties) continue;
    if (property.fieldType === "ImageList" || property.fieldType === "FileList") continue;
    const defaultCount = Number(property.defaultItems ?? property.minItems ?? 0);
    const markers: Array<{ _itemId: string }> = [];
    let previousPosition: string | null = null;
    for (let index = 0; index < defaultCount; index += 1) {
      const id = `peek_${++counter.value}`;
      const itemContent: Record<string, unknown> = {};
      for (const [key, itemProperty] of Object.entries(property.items.properties) as Array<
        [string, any]
      >) {
        if (itemProperty.type === "array" && itemProperty.items?.properties) continue;
        if ("default" in itemProperty) itemContent[key] = itemProperty.default;
      }
      const position = generateKeyBetween(previousPosition, null);
      previousPosition = position;
      items.push({
        id,
        blockId,
        parentItemId,
        fieldName,
        content: itemContent,
        settings: property.defaultItemSettings ? { ...property.defaultItemSettings } : null,
        summary: "",
        title: "",
        position,
        createdAt: 0,
        updatedAt: 0,
        projectId: null,
        sharedContentType: null,
        references: {},
      });
      markers.push({ _itemId: id });
      const nestedContent: Record<string, unknown> = {};
      buildPeekItems(property.items.properties, blockId, id, nestedContent, items, counter);
      const item = items.find((candidate) => candidate.id === id);
      if (item) item.content = { ...(item.content as object), ...nestedContent };
    }
    content[fieldName] = markers;
  }
}

function createViewBlock(options: EditableOptions) {
  const fields = resolveBlockFields(options);
  const typeboxSchema = TypeBoxType.Object(fields.content);
  const settingsTypeboxSchema = fields.settings ? TypeBoxType.Object(fields.settings) : null;
  const contentDefaults = collectDefaults(typeboxSchema.properties);
  const settingsDefaults = settingsTypeboxSchema
    ? collectDefaults(settingsTypeboxSchema.properties)
    : {};
  const repeatableDefaults: Record<string, Record<string, unknown>> = {};
  const repeatableSettingsDefaults: Record<string, Record<string, unknown>> = {};
  for (const [key, property] of Object.entries(typeboxSchema.properties) as Array<[string, any]>) {
    if (property.fieldType !== "Repeater") continue;
    repeatableDefaults[key] = collectDefaults(property.items?.properties ?? {});
    repeatableSettingsDefaults[key] = { ...property.defaultItemSettings };
  }

  const Context = React.createContext<BlockContextValue | null>(null);
  const RepeaterContext = React.createContext<RepeaterContextValue | null>(null);

  function useValue(name: PropertyKey) {
    const block = React.use(Context);
    const item = React.use(RepeaterContext);
    if (!block) throw new Error("Field must be used within a Block Component");
    return item ? item.itemContent[name as string] : block.content[name as string];
  }

  const Field = ({ name, textStyle, linkStyle, children }: any) => {
    const editingRuntime = useBlockEditingRuntime();
    if (editingRuntime) {
      return editingRuntime.renderPrimitive(options, "Field", {
        name,
        textStyle,
        linkStyle,
        children,
      });
    }
    const value = useValue(name);
    const pages = useLinkPages(useProjectUuid());
    const pathname = useLocation({ select: (location) => location.pathname });
    return children(
      {
        children: markdownToReactNodes(value, {
          pages,
          fallbackHref: pathname,
          textStyle,
          linkStyle,
        }),
      },
      { text: value },
    );
  };

  const Icon = ({ name, ...props }: any) => {
    const editingRuntime = useBlockEditingRuntime();
    if (editingRuntime) return editingRuntime.renderPrimitive(options, "Icon", { name, ...props });
    return <IconSvg iconId={useValue(name) as string} {...props} />;
  };

  const Embed = ({ name, children }: any) => {
    const editingRuntime = useBlockEditingRuntime();
    if (editingRuntime) return editingRuntime.renderPrimitive(options, "Embed", { name, children });
    const rawValue = useValue(name);
    const value = typeof rawValue === "string" ? rawValue : "";
    return children({ src: value }, { url: value });
  };

  const Artifact = ({ name, children }: any) => {
    const editingRuntime = useBlockEditingRuntime();
    if (editingRuntime) {
      return editingRuntime.renderPrimitive(options, "Artifact", { name, children });
    }
    const value = useValue(name);
    const data = useArtifactData(name);
    const hostProps = useArtifactHost({
      studio: React.use(ArtifactStudioContext),
      data,
      size: useFieldSchema(name)?.size,
      navigate: useNavigate(),
    });
    const initialData = useInitialArtifactData(value, data);
    const fontLinks = useOptionalCamoxApp()?.getArtifactFontLinks();
    const runs = React.use(ArtifactsRunContext);
    if (!isArtifactSource(value)) return null;
    return children({
      ...(runs
        ? artifactFrameProps(value, { fontLinks, data: initialData })
        : artifactStandInProps(value)),
      ...hostProps,
    });
  };

  /** An artifact's Artifact Data, from its block's or item's content and settings. */
  function useArtifactData(name: string) {
    const block = React.use(Context);
    const item = React.use(RepeaterContext);
    const { filesMap } = useNormalizedData();
    const pages = useLinkPages(useProjectUuid());
    const pathname = useLocation({ select: (location) => location.pathname });
    if (!block) throw new Error("Artifact must be used within a Block Component");
    const field = item ? item.itemSchema?.[name] : typeboxSchema.properties[name];
    const owner = item
      ? { content: item.itemContent, settings: item.itemSettings }
      : { content: block.content, settings: block.settings };
    return artifactData(field, owner, {
      linkHref: (link) => resolveLinkHref(normalizeLinkValue(link), pages, pathname) ?? pathname,
      asset: (value) => resolveAssetValue(value, filesMap) as Record<string, unknown> | null,
    });
  }

  const Link = ({ name, children }: any) => {
    const editingRuntime = useBlockEditingRuntime();
    if (editingRuntime) return editingRuntime.renderPrimitive(options, "Link", { name, children });
    const value = normalizeLinkValue((useValue(name) ?? {}) as Record<string, unknown>);
    const pages = useLinkPages(useProjectUuid());
    const pathname = useLocation({ select: (location) => location.pathname });
    const href = resolveLinkHref(value, pages, pathname);
    if (href == null) return value.text;
    return children(
      {
        to: href,
        target: value.newTab ? "_blank" : undefined,
        rel: value.newTab ? "noreferrer" : undefined,
        children: value.text,
      },
      { text: value.text, href, newTab: value.newTab },
    );
  };

  function useAsset(name: PropertyKey) {
    const block = React.use(Context);
    const item = React.use(RepeaterContext);
    const { filesMap } = useNormalizedData();
    if (!block) throw new Error("Asset must be used within a Block Component");
    const raw = item ? item.itemContent[name as string] : block.content[name as string];
    const resolved = resolveAssetValue(raw, filesMap);
    const fallback = item
      ? repeatableDefaults[item.arrayFieldName]?.[String(name)]
      : contentDefaults[String(name)];
    return resolved ?? fallback;
  }

  const Image = ({ name, children }: any) => {
    const editingRuntime = useBlockEditingRuntime();
    if (editingRuntime) return editingRuntime.renderPrimitive(options, "Image", { name, children });
    const value = useAsset(name) as ImageValue;
    return renderImagePlaceholder(
      value,
      children(
        {
          src: transformImageUrl(value.url, {
            width: getDefaultImageWidth(),
            mimeType: value.mimeType,
            size: value.size,
          }),
          srcSet: buildImageSrcSet(value.url, value.mimeType, value.size),
          sizes: getDefaultImageSizes(),
          alt: value.alt,
        },
        value,
      ),
    );
  };

  const File = ({ name, children }: any) => {
    const editingRuntime = useBlockEditingRuntime();
    if (editingRuntime) return editingRuntime.renderPrimitive(options, "File", { name, children });
    const value = useAsset(name) as FileValue;
    return children({ href: value.url, download: value.filename }, value);
  };

  const ReferencePrimitive = ({ primitive: Primitive, ...props }: any) => {
    const value = useValue(props.name);
    if (value == null) return null;
    return <Primitive {...props} />;
  };
  const ReferenceImage = (props: any) => <ReferencePrimitive primitive={Image} {...props} />;
  const ReferenceFile = (props: any) => <ReferencePrimitive primitive={File} {...props} />;
  const ReferenceEmbed = (props: any) => <ReferencePrimitive primitive={Embed} {...props} />;

  /** A field's schema: in the block, the enclosing item, or the placed record. */
  function useFieldSchema(name: string) {
    const block = React.use(Context);
    const item = React.use(RepeaterContext);
    if (item) return item.itemSchema?.[name];
    return (block?.sourceSchema ?? typeboxSchema.properties)[name];
  }

  const Reference = ({ name, children }: any) => {
    const editingRuntime = useBlockEditingRuntime();
    if (editingRuntime)
      return editingRuntime.renderPrimitive(options, "Reference", { name, children });
    const block = React.use(Context);
    const { recordsMap } = useNormalizedData();
    if (!block) throw new Error("Reference must be used within a Block Component");
    const schema = useFieldSchema(name);
    const record = resolveReference(useValue(name), schema.collectionId, recordsMap);
    if (!record) return null;
    return (
      <RecordScope block={block} schema={schema} record={record}>
        {children}
      </RecordScope>
    );
  };

  const ReferenceList = ({ name, children }: any) => {
    const editingRuntime = useBlockEditingRuntime();
    if (editingRuntime)
      return editingRuntime.renderPrimitive(options, "ReferenceList", { name, children });
    const block = React.use(Context);
    const item = React.use(RepeaterContext);
    const normalizedData = useNormalizedData();
    if (!block) throw new Error("ReferenceList must be used within a Block Component");
    const schema = useFieldSchema(name);
    const stored = useValue(name);
    // A query-backed list stores nothing: the server resolved its records for the owner.
    const ids = isQueryBacked(schema)
      ? queryResultIds(normalizedData, { blockId: block.blockId, itemId: item?.itemId }, name)
      : stored;
    const { recordsMap } = normalizedData;
    return resolveReferenceList(ids, schema.collectionId, recordsMap).map((record) => (
      <RecordScope key={record.id} block={block} schema={schema} record={record}>
        {children}
      </RecordScope>
    ));
  };

  /**
   * Renders a placed record with the record's content as the field source. Records placed by the
   * block or an item (the first hop) also render the records they link (the second hop).
   */
  const RecordScope = ({
    block,
    schema,
    record,
    children,
  }: {
    block: BlockContextValue;
    schema: any;
    record: ReferenceRecord;
    children: (scope: any) => React.ReactNode;
  }) => {
    const hop = block.recordHop ? 2 : 1;
    return (
      <RepeaterContext.Provider value={null}>
        <Context.Provider
          value={{
            ...block,
            content: record.content,
            sourceSchema: schema.referenceSchema.properties,
            recordHop: hop,
          }}
        >
          {children({
            id: record.id,
            title: record.title,
            description: record.description,
            Field,
            Image: ReferenceImage,
            File: ReferenceFile,
            Embed: ReferenceEmbed,
            ImageList,
            FileList,
            ...(hop === 1 ? { Reference, ReferenceList } : {}),
          })}
        </Context.Provider>
      </RepeaterContext.Provider>
    );
  };

  const AssetList = ({ name, children, primitive }: any) => {
    const editingRuntime = useBlockEditingRuntime();
    if (editingRuntime) {
      return editingRuntime.renderPrimitive(options, primitive, { name, children });
    }
    const block = React.use(Context);
    const parent = React.use(RepeaterContext);
    const { filesMap } = useNormalizedData();
    if (!block) throw new Error("ImageList/FileList must be used within a Block Component");
    const fieldName = String(name);
    const schema = parent
      ? (typeboxSchema.properties as any)[parent.arrayFieldName]?.items?.properties?.[fieldName]
      : (block.sourceSchema ?? typeboxSchema.properties)[fieldName];
    const fieldType = schema?.fieldType;
    if (fieldType !== "ImageList" && fieldType !== "FileList") {
      throw new Error(`"${fieldName}" is not an imageList or fileList field`);
    }
    const source = parent ? parent.itemContent[fieldName] : block.content[fieldName];
    let values = Array.isArray(source) ? source : [];
    if (values.length === 0 && schema.defaultItems > 0 && schema.items?.default) {
      values = Array.from({ length: schema.defaultItems }, () => schema.items.default);
    }
    const Single = fieldType === "ImageList" ? Image : File;
    return values
      .map((value) => resolveAssetValue(value, filesMap))
      .filter(Boolean)
      .map((value, index) => (
        <RepeaterContext.Provider
          key={index}
          value={{
            arrayFieldName: fieldName,
            containerItemId: parent?.itemId ?? parent?.containerItemId,
            itemContent: { [ASSET_LIST_SELF_KEY]: value },
            itemSettings: {},
          }}
        >
          <Single name={ASSET_LIST_SELF_KEY}>{children}</Single>
        </RepeaterContext.Provider>
      ));
  };

  const ImageList = (props: any) => <AssetList {...props} primitive="ImageList" />;
  const FileList = (props: any) => <AssetList {...props} primitive="FileList" />;

  const Repeater = ({ name, children }: any) => {
    const editingRuntime = useBlockEditingRuntime();
    if (editingRuntime) {
      return editingRuntime.renderPrimitive(options, "Repeater", { name, children });
    }
    const block = React.use(Context);
    const parent = React.use(RepeaterContext);
    const { itemsMap } = useNormalizedData();
    if (!block) throw new Error("Repeater must be used within a Block Component");
    const fieldName = String(name);
    const source = parent ? parent.itemContent[fieldName] : block.content[fieldName];
    if (!Array.isArray(source)) throw new Error(`Field "${fieldName}" is not an array`);
    const itemSchema = (
      parent ? parent.itemSchema?.[fieldName] : typeboxSchema.properties[fieldName]
    )?.items?.properties;
    const values = source
      .map((item) => (isItemMarker(item) ? (itemsMap.get(item._itemId) ?? null) : item))
      .filter(Boolean);
    return values.map((item: any, index) => {
      const databaseItem = item.content !== undefined && item.id != null;
      const itemContent = {
        ...repeatableDefaults[fieldName],
        ...(databaseItem ? item.content : item),
      };
      const itemSettings = {
        ...repeatableSettingsDefaults[fieldName],
        ...(databaseItem ? item.settings : null),
      };
      const itemId = databaseItem ? item.id : undefined;
      const api = {
        Field,
        Icon,
        Link,
        Embed,
        Artifact,
        Image,
        File,
        ImageList,
        FileList,
        Repeater,
        Reference,
        ReferenceList,
        useSetting: (settingName: string) => itemSettings[settingName],
      };
      return (
        <RepeaterContext.Provider
          key={itemId ?? index}
          value={{
            arrayFieldName: fieldName,
            containerItemId: itemId ?? parent?.containerItemId,
            itemContent,
            itemId,
            itemSettings,
            itemSchema,
          }}
        >
          {children(api, index)}
        </RepeaterContext.Provider>
      );
    });
  };

  const useSetting = (name: string) => {
    const editingRuntime = useBlockEditingRuntime();
    if (editingRuntime) return editingRuntime.useSetting(options, name);
    const context = React.use(Context);
    if (!context) throw new Error("useSetting must be used within a Block Component");
    return context.settings[name];
  };

  const Detached = ({ children }: any) => {
    const editingRuntime = useBlockEditingRuntime();
    if (editingRuntime) {
      return editingRuntime.renderPrimitive(options, "Detached", { children });
    }
    return children({
      ref: () => {},
      style: { opacity: 1 },
      onClick: () => {},
      onMouseEnter: () => {},
      onMouseLeave: () => {},
    });
  };

  const Component = (props: any) => {
    const editingRuntime = useBlockEditingRuntime();
    if (editingRuntime) return editingRuntime.renderBlock(options, props);

    const { blockData, mode } = props;
    const mergedContent = { ...contentDefaults, ...blockData.content };
    const normalizedContent = { ...mergedContent } as Record<string, unknown>;
    for (const [key, value] of Object.entries(normalizedContent)) {
      if (Array.isArray(value) && value[0]?.content !== undefined) {
        normalizedContent[key] = value.map((item) => item.content);
      }
    }
    const ToReact = options.toReact as React.ComponentType<any>;
    const settings = { ...settingsDefaults, ...blockData.settings };
    return (
      <div
        className="group visual-editing-block"
        data-camox-viewport-block={blockData._id}
        style={{
          position: "relative",
          scrollMargin: "5rem",
        }}
      >
        <Context.Provider
          value={{
            blockId: blockData._id,
            content: mergedContent,
            settings,
            mode,
          }}
        >
          <ToReact content={normalizedContent} settings={settings} />
        </Context.Provider>
      </div>
    );
  };

  const contentSchema = {
    type: "object" as const,
    title: options.title,
    description: options.description,
    properties: typeboxSchema.properties,
    required: Object.keys(fields.content),
    toMarkdown: resolveToMarkdown(
      options.toMarkdown as any,
      fields.settings,
      "block",
      fields.content,
    ),
    toTitle: resolveToTitle(options.toTitle as any, fields.settings, "block", fields.content),
  };
  const settingsSchema = settingsTypeboxSchema
    ? {
        type: "object" as const,
        properties: settingsTypeboxSchema.properties,
        required: Object.keys(fields.settings ?? {}),
      }
    : undefined;

  const getInitialBundle = () => {
    const content = { ...contentDefaults };
    const repeatableItems: Array<Record<string, unknown>> = [];
    buildInitialItems(typeboxSchema.properties, null, content, repeatableItems, { value: 0 });
    const storageContent: Record<string, unknown> = {};
    for (const [key, property] of Object.entries(typeboxSchema.properties) as Array<
      [string, any]
    >) {
      if (["Image", "File", "ImageList", "FileList", "Repeater"].includes(property.fieldType)) {
        continue;
      }
      if ("default" in property) storageContent[key] = property.default;
    }
    return { content: storageContent, settings: { ...settingsDefaults }, repeatableItems };
  };

  return {
    Detached,
    Icon,
    Field,
    Embed,
    Artifact,
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
      Component,
      id: options.id,
      title: options.title,
      description: options.description,
      contentSchema,
      settingsSchema,
      layoutOnly: options.layoutOnly ?? false,
      synced: options.synced ?? false,
      getInitialBundle,
      getInitialContent: () => {
        const content = { ...contentDefaults };
        for (const [key, property] of Object.entries(typeboxSchema.properties) as Array<
          [string, any]
        >) {
          if (["Image", "File", "ImageList", "FileList", "Repeater"].includes(property.fieldType)) {
            delete content[key];
          }
        }
        return content;
      },
      getInitialSettings: () => ({ ...settingsDefaults }),
      getPeekBundle: () => {
        const content = { ...contentDefaults };
        const repeatableItems: Array<Record<string, unknown>> = [];
        buildPeekItems(typeboxSchema.properties, "peek", null, content, repeatableItems, {
          value: 0,
        });
        return {
          block: {
            id: "peek",
            pageId: null,
            layoutId: null,
            type: options.id,
            content,
            settings: settingsDefaults,
            slot: null,
            summary: "",
            title: "",
            position: "",
            createdAt: 0,
            updatedAt: 0,
          },
          repeatableItems,
          files: [],
        };
      },
    },
  };
}

export const createBlock = createViewBlock as unknown as EditableCreateBlock;
export type Block = ReturnType<typeof createBlock>;
