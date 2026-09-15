import { Type as TypeBoxType } from "@sinclair/typebox";
import { useQuery } from "@tanstack/react-query";
import { generateKeyBetween } from "fractional-indexing";
import * as React from "react";

import { useLocation } from "../features/navigation/navigation";
import { useProjectSlug } from "../lib/auth";
import {
  isFileMarker,
  isItemMarker,
  resolveFileMarker,
  useNormalizedData,
} from "../lib/normalized-data";
import { type Page, viewPageQueries, viewProjectQueries } from "../lib/view-queries";
import { useBlockEditingRuntime } from "./editing/BlockEditingRuntime";
import {
  Type,
  resolveToMarkdown,
  type FileValue,
  type ImageValue,
  type LinkValue,
} from "./lib/contentType";
import {
  buildImageSrcSet,
  getDefaultImageSizes,
  getDefaultImageWidth,
  transformImageUrl,
} from "./lib/imageTransform";
import { markdownToReactNodes } from "./lib/lexicalReact";

export { Type };
export type {
  BlockComponentProps,
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
  blockId: number;
  content: Record<string, unknown>;
  settings: Record<string, unknown>;
  mode: "site" | "peek" | "layout";
}

interface RepeaterContextValue {
  arrayFieldName: string;
  containerItemId?: number;
  itemContent: Record<string, unknown>;
  itemId?: number;
  itemSettings: Record<string, unknown>;
}

const ASSET_LIST_SELF_KEY = "__camox_asset_self__";

function normalizeLinkValue(value: Record<string, unknown>): LinkValue {
  if (value.type) return value as unknown as LinkValue;
  return { type: "external", ...value } as LinkValue;
}

function resolveLinkHref(
  link: LinkValue,
  pages: Array<{ id: number; fullPath: string }> | undefined,
  pathname: string,
) {
  if (link.type === "page") {
    return pages?.find((page) => String(page.id) === link.pageId)?.fullPath ?? pathname;
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
  blockId: number,
  parentItemId: number | null,
  content: Record<string, unknown>,
  items: Array<Record<string, unknown>>,
  counter: { value: number },
) {
  for (const [fieldName, property] of Object.entries(properties)) {
    if (property.type !== "array" || !property.items?.properties) continue;
    if (property.fieldType === "ImageList" || property.fieldType === "FileList") continue;
    const defaultCount = Number(property.defaultItems ?? property.minItems ?? 0);
    const markers: Array<{ _itemId: number }> = [];
    let previousPosition: string | null = null;
    for (let index = 0; index < defaultCount; index += 1) {
      const id = --counter.value;
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
        position,
        createdAt: 0,
        updatedAt: 0,
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
  const typeboxSchema = TypeBoxType.Object(options.content);
  const settingsTypeboxSchema = options.settings ? TypeBoxType.Object(options.settings) : null;
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
    const projectSlug = useProjectSlug();
    const { data: project } = useQuery(viewProjectQueries.getBySlug(projectSlug));
    const { data: pages } = useQuery({
      ...viewPageQueries.list(project?.id ?? 0),
      enabled: !!project,
    });
    const pathname = useLocation({ select: (location) => location.pathname });
    return children(
      {
        children: markdownToReactNodes(value, {
          pages: pages as Page[] | undefined,
          fallbackHref: pathname,
          textStyle,
          linkStyle,
        }),
      },
      { text: value },
    );
  };

  const Embed = ({ name, children }: any) => {
    const editingRuntime = useBlockEditingRuntime();
    if (editingRuntime) return editingRuntime.renderPrimitive(options, "Embed", { name, children });
    const rawValue = useValue(name);
    const value = typeof rawValue === "string" ? rawValue : "";
    return children({ src: value }, { url: value });
  };

  const Link = ({ name, children }: any) => {
    const editingRuntime = useBlockEditingRuntime();
    if (editingRuntime) return editingRuntime.renderPrimitive(options, "Link", { name, children });
    const value = normalizeLinkValue((useValue(name) ?? {}) as Record<string, unknown>);
    const projectSlug = useProjectSlug();
    const { data: project } = useQuery(viewProjectQueries.getBySlug(projectSlug));
    const { data: pages } = useQuery({
      ...viewPageQueries.list(project?.id ?? 0),
      enabled: !!project,
    });
    const pathname = useLocation({ select: (location) => location.pathname });
    const href = resolveLinkHref(value, pages as Page[] | undefined, pathname);
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
    const resolved = isFileMarker(raw) ? resolveFileMarker(raw, filesMap) : raw;
    const fallback = item
      ? repeatableDefaults[item.arrayFieldName]?.[String(name)]
      : contentDefaults[String(name)];
    return resolved ?? fallback;
  }

  const Image = ({ name, children }: any) => {
    const editingRuntime = useBlockEditingRuntime();
    if (editingRuntime) return editingRuntime.renderPrimitive(options, "Image", { name, children });
    const value = useAsset(name) as ImageValue;
    return children(
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
    );
  };

  const File = ({ name, children }: any) => {
    const editingRuntime = useBlockEditingRuntime();
    if (editingRuntime) return editingRuntime.renderPrimitive(options, "File", { name, children });
    const value = useAsset(name) as FileValue;
    return children({ href: value.url, download: value.filename }, value);
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
      : (typeboxSchema.properties as any)[fieldName];
    const fieldType = schema?.fieldType;
    if (fieldType !== "ImageList" && fieldType !== "FileList") {
      throw new Error(`"${fieldName}" is not a Type.ImageList or Type.FileList field`);
    }
    const source = parent ? parent.itemContent[fieldName] : block.content[fieldName];
    let values = Array.isArray(source) ? source : [];
    if (values.length === 0 && schema.defaultItems > 0 && schema.items?.default) {
      values = Array.from({ length: schema.defaultItems }, () => schema.items.default);
    }
    const Single = fieldType === "ImageList" ? Image : File;
    return values
      .map((value) => (isFileMarker(value) ? resolveFileMarker(value, filesMap) : value))
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
        Link,
        Embed,
        Image,
        File,
        ImageList,
        FileList,
        Repeater,
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
          }}
        >
          {children(api, index)}
        </RepeaterContext.Provider>
      );
    });
  };

  const useSetting = (name: string) => {
    const editingRuntime = useBlockEditingRuntime();
    if (editingRuntime) return editingRuntime.getSetting(options, name);
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
    const AuthoredComponent = options.component;
    return (
      <div
        className="group visual-editing-block"
        style={{
          position: "relative",
          scrollMargin: "5rem",
          background: "var(--background)",
        }}
      >
        <Context.Provider
          value={{
            blockId: blockData._id,
            content: mergedContent,
            settings: { ...settingsDefaults, ...blockData.settings },
            mode,
          }}
        >
          <AuthoredComponent content={normalizedContent} />
        </Context.Provider>
        <div className="camox-sheet-overlay" />
      </div>
    );
  };

  const contentSchema = {
    type: "object" as const,
    title: options.title,
    description: options.description,
    properties: typeboxSchema.properties,
    required: Object.keys(options.content),
    toMarkdown: resolveToMarkdown(options.toMarkdown as any, options.settings, "block"),
  };
  const settingsSchema = settingsTypeboxSchema
    ? {
        type: "object" as const,
        properties: settingsTypeboxSchema.properties,
        required: Object.keys(options.settings ?? {}),
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
    Field,
    Embed,
    Link,
    Image,
    File,
    ImageList,
    FileList,
    Repeater,
    useSetting,
    _internal: {
      Component,
      id: options.id,
      title: options.title,
      description: options.description,
      contentSchema,
      settingsSchema,
      layoutOnly: options.layoutOnly ?? false,
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
        buildPeekItems(typeboxSchema.properties, -1, null, content, repeatableItems, { value: 0 });
        return {
          block: {
            id: -1,
            pageId: null,
            layoutId: null,
            type: options.id,
            content,
            settings: settingsDefaults,
            placement: null,
            summary: "",
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
