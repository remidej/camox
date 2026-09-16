import { Button } from "@camox/ui/button";
import { Label } from "@camox/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@camox/ui/select";
import { Spinner } from "@camox/ui/spinner";
import { Switch } from "@camox/ui/switch";
import { useMutation, useQueries, useQuery } from "@tanstack/react-query";
import { useSelector } from "@xstate/store-react";
import { CircleMinus, CirclePlus, CornerLeftUp } from "lucide-react";
import * as React from "react";

import { useRequireDraftSource } from "@/core/hooks/useRequireDraftSource";
import { fieldTypesDictionary } from "@/core/lib/fieldTypes";
import { isFileMarker, type NormalizedItem } from "@/lib/normalized-data";
import { blockMutations, blockQueries, fileQueries, repeatableItemMutations } from "@/lib/queries";
import { trackClientEvent } from "@/lib/telemetry-client";
import { cn } from "@/lib/utils";

import { useCamoxApp } from "../../provider/components/CamoxAppContext";
import type { OverlayMessage } from "../overlayMessages";
import { previewStore, selectionBlockId, selectionField, selectionItemId } from "../previewStore";
import { SingleAssetFieldEditor } from "./AssetFieldEditor";
import { type SchemaField, formatFieldName } from "./ItemFieldsEditor";
import { ItemFieldsEditor } from "./ItemFieldsEditor";
import { LinkFieldEditor } from "./LinkFieldEditor";
import { MultipleAssetFieldEditor } from "./MultipleAssetFieldEditor";
import { type RepeatableArraySchema, useRepeatableItemActions } from "./useRepeatableItemActions";

/* -------------------------------------------------------------------------------------------------
 * Helper: Get settings fields from schema
 * -----------------------------------------------------------------------------------------------*/

const getSettingsFields = (schema: unknown): SchemaField[] => {
  const properties = (schema as any)?.properties;
  if (!properties) return [];

  return Object.keys(properties).map((fieldName) => {
    const prop = properties[fieldName] as any;
    return {
      name: fieldName,
      fieldType: prop.fieldType as SchemaField["fieldType"],
      label: prop.title as string | undefined,
      enumLabels: prop.enumLabels as Record<string, string> | undefined,
      enumValues: prop.enum as string[] | undefined,
    };
  });
};

/* -------------------------------------------------------------------------------------------------
 * Schema traversal helper — walk up parent chain to find schema for an item
 * -----------------------------------------------------------------------------------------------*/

/**
 * Builds the path of fieldNames from the block root to the given item,
 * then walks the schema down that path to return the sub-schema for the item's fields.
 */
const getSchemaForItem = (
  contentSchema: unknown,
  itemId: number,
  itemsMap: Map<number, NormalizedItem>,
): unknown => {
  // Build path from root to this item
  const path: string[] = [];
  let current = itemsMap.get(itemId);
  while (current) {
    path.unshift(current.fieldName);
    current = current.parentItemId ? itemsMap.get(current.parentItemId) : undefined;
  }

  // Walk schema down the path
  let schema = contentSchema;
  for (const fieldName of path) {
    const prop = (schema as any)?.properties?.[fieldName];
    if (!prop?.items) return null;
    schema = prop.items;
  }
  return schema;
};

/**
 * Like `getSchemaForItem` but returns the **array** schema (one level above
 * the items schema), where per-item settings metadata lives.
 */
const getArraySchemaForItem = (
  contentSchema: unknown,
  itemId: number,
  itemsMap: Map<number, NormalizedItem>,
): unknown => {
  const path: string[] = [];
  let current = itemsMap.get(itemId);
  while (current) {
    path.unshift(current.fieldName);
    current = current.parentItemId ? itemsMap.get(current.parentItemId) : undefined;
  }

  let schema = contentSchema;
  for (let i = 0; i < path.length; i++) {
    const prop = (schema as any)?.properties?.[path[i]];
    if (!prop?.items) return null;
    if (i === path.length - 1) return prop;
    schema = prop.items;
  }
  return null;
};

/**
 * Builds the ancestor chain from root to this item (inclusive).
 * Returns items in order from root-most ancestor to the item itself.
 */
const buildAncestorChain = (
  itemId: number,
  itemsMap: Map<number, NormalizedItem>,
): NormalizedItem[] => {
  const chain: NormalizedItem[] = [];
  let current = itemsMap.get(itemId);
  while (current) {
    chain.unshift(current);
    current = current.parentItemId ? itemsMap.get(current.parentItemId) : undefined;
  }
  return chain;
};

/* -------------------------------------------------------------------------------------------------
 * PageEditorSidebar
 * -----------------------------------------------------------------------------------------------*/

const PageEditorSidebar = () => {
  const camoxApp = useCamoxApp();
  const updateContent = useMutation(blockMutations.updateContent());
  const updateSettings = useMutation(blockMutations.updateSettings());
  const updateRepeatableContent = useMutation(repeatableItemMutations.updateContent());
  const updateRepeatableSettings = useMutation(repeatableItemMutations.updateSettings());
  const requireDraft = useRequireDraftSource();

  // Get state from store
  const selection = useSelector(previewStore, (state) => state.context.selection);
  const iframeElement = useSelector(previewStore, (state) => state.context.iframeElement);

  const postToIframe = React.useCallback(
    (message: OverlayMessage) => {
      if (!iframeElement?.contentWindow) return;
      iframeElement.contentWindow.postMessage(message, "*");
    },
    [iframeElement],
  );

  const blockId = selectionBlockId(selection);
  const currentItemId = selectionItemId(selection);
  const fieldInfo = selectionField(selection);

  // Look up the actual block data from individual block cache (granular caching)
  const { data: blockBundle } = useQuery({
    ...blockQueries.get(blockId!),
    enabled: blockId != null,
  });
  const block = blockBundle?.block ?? null;
  const itemsMap = React.useMemo(
    () => new Map((blockBundle?.repeatableItems ?? []).map((i) => [i.id, i])),
    [blockBundle?.repeatableItems],
  );
  const fileIds = React.useMemo(
    () => (blockBundle?.files ?? []).map((f) => f.id),
    [blockBundle?.files],
  );

  const fileResults = useQueries({
    queries: fileIds.map((id) => fileQueries.get(id)),
  });

  const filesMap = React.useMemo(() => {
    const map = new Map((blockBundle?.files ?? []).map((f) => [f.id, f]));
    for (let i = 0; i < fileIds.length; i++) {
      const data = fileResults[i]?.data;
      if (data) map.set(data.id, data);
    }
    return map;
  }, [blockBundle?.files, fileIds, fileResults]);

  // Get block definition
  const blockDef = block ? camoxApp.getBlockById(block.type) : null;

  const settingsFields = React.useMemo(() => {
    return blockDef ? getSettingsFields(blockDef._internal.settingsSchema) : [];
  }, [blockDef]);

  const itemArraySchema = React.useMemo(() => {
    if (!blockDef || currentItemId == null) return null;
    return getArraySchemaForItem(blockDef._internal.contentSchema, currentItemId, itemsMap);
  }, [blockDef, currentItemId, itemsMap]);

  const itemSettingsFields = React.useMemo(() => {
    return getSettingsFields((itemArraySchema as any)?.itemSettingsSchema);
  }, [itemArraySchema]);

  // Compute schema and data based on selection
  const currentSchema = React.useMemo(() => {
    if (!blockDef) return null;
    if (currentItemId == null) return blockDef._internal.contentSchema;
    return getSchemaForItem(blockDef._internal.contentSchema, currentItemId, itemsMap);
  }, [blockDef, currentItemId, itemsMap]);

  const currentItem = currentItemId != null ? itemsMap.get(currentItemId) : null;
  const isItemLoading = currentItemId != null && !currentItem;

  const siblingCount = React.useMemo(() => {
    if (!currentItem) return 0;
    let count = 0;
    for (const it of itemsMap.values()) {
      if (it.fieldName === currentItem.fieldName && it.parentItemId === currentItem.parentItemId) {
        count++;
      }
    }
    return count;
  }, [currentItem, itemsMap]);

  const {
    canAdd: canAddSibling,
    addItem: addSibling,
    canRemove: canRemoveCurrent,
    removeItem: removeCurrent,
  } = useRepeatableItemActions({
    blockId: block?.id ?? -1,
    fieldName: currentItem?.fieldName ?? "",
    parentItemId: currentItem?.parentItemId ?? null,
    arraySchema: itemArraySchema as RepeatableArraySchema | null,
    siblingCount,
  });

  const rawCurrentData: Record<string, unknown> = currentItem
    ? (currentItem.content as Record<string, unknown>)
    : (block?.content ?? {});

  // Resolve _fileId markers in data for asset field editors (recursive for inline arrays)
  const currentData = React.useMemo(() => {
    const resolveFile = (marker: { _fileId: number }) => {
      const file = filesMap.get(marker._fileId);
      return file
        ? {
            url: file.url,
            alt: file.alt,
            filename: file.filename,
            mimeType: file.mimeType,
            _fileId: marker._fileId,
          }
        : { url: "", alt: "", filename: "", mimeType: "" };
    };

    const resolveValue = (value: unknown): unknown => {
      if (isFileMarker(value)) return resolveFile(value);
      if (Array.isArray(value)) return value.map(resolveValue);
      if (value && typeof value === "object" && !Array.isArray(value)) {
        const obj = value as Record<string, unknown>;
        const resolved: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(obj)) {
          resolved[k] = resolveValue(v);
        }
        return resolved;
      }
      return value;
    };

    const resolved: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(rawCurrentData)) {
      resolved[key] = resolveValue(value);
    }
    return resolved;
  }, [rawCurrentData, filesMap]);

  // Detect terminal field view
  const isViewingLink = fieldInfo?.fieldType === "Link";
  const linkFieldName = isViewingLink ? fieldInfo.fieldName : null;

  const isViewingImage = fieldInfo?.fieldType === "Image";
  const imageFieldName = isViewingImage ? fieldInfo.fieldName : null;

  const isViewingFile = fieldInfo?.fieldType === "File";
  const fileFieldName = isViewingFile ? fieldInfo.fieldName : null;

  const isViewingAsset = isViewingImage || isViewingFile;
  const assetFieldName = imageFieldName ?? fileFieldName;
  const assetType: "Image" | "File" = isViewingImage ? "Image" : "File";

  const isMultipleAsset = React.useMemo(() => {
    if (!isViewingAsset || !assetFieldName) return false;
    const prop = (currentSchema as any)?.properties?.[assetFieldName];
    return prop?.fieldType === "ImageList" || prop?.fieldType === "FileList";
  }, [isViewingAsset, assetFieldName, currentSchema]);

  // Track sidebar visibility (once per selected block) + reset dirty flag for block_edited
  const sessionDirtyRef = React.useRef(false);
  const trackedBlockIdRef = React.useRef<number | null>(null);
  React.useEffect(() => {
    if (!block) {
      trackedBlockIdRef.current = null;
      return;
    }
    if (trackedBlockIdRef.current === block.id) return;
    trackedBlockIdRef.current = block.id;
    sessionDirtyRef.current = false;
    trackClientEvent("page_editor_sidebar_opened", { blockType: block.type });
  }, [block]);

  React.useEffect(() => {
    if (!block) return;

    return () => {
      if (!sessionDirtyRef.current) return;
      trackClientEvent("block_edited", {
        via: "page-editor-sidebar",
        blockType: block.type,
      });
      sessionDirtyRef.current = false;
    };
  }, [block]);

  // Scope field DOM ids with useId so label-input pairs and imperative focus
  // lookups don't collide if this sheet is ever rendered more than once.
  const fieldIdPrefix = React.useId();

  const handleBlockFieldChange = React.useCallback(
    (fieldName: string, value: unknown) => {
      if (!block) return;
      if (!requireDraft()) return;
      sessionDirtyRef.current = true;
      updateContent.mutate({ id: block.id, content: { [fieldName]: value } });
    },
    [block, updateContent, requireDraft],
  );

  const handleItemFieldChange = React.useCallback(
    (fieldName: string, value: unknown) => {
      if (currentItemId == null) return;
      if (!requireDraft()) return;
      sessionDirtyRef.current = true;
      updateRepeatableContent.mutate({
        id: currentItemId,
        content: { [fieldName]: value },
      });
    },
    [currentItemId, updateRepeatableContent, requireDraft],
  );

  const activeFieldChangeHandler =
    currentItemId != null ? handleItemFieldChange : handleBlockFieldChange;

  // Build selection path display from the ancestor chain
  const ancestorChain = React.useMemo(
    () => (currentItemId != null ? buildAncestorChain(currentItemId, itemsMap) : []),
    [currentItemId, itemsMap],
  );

  if (!block || !blockDef || !currentSchema) {
    return (
      <div className="text-muted-foreground flex flex-1 items-center justify-center px-2 text-sm">
        <Spinner className="mr-2 size-3.5" /> Loading block...
      </div>
    );
  }

  const fieldHasOwnView = fieldInfo ? fieldTypesDictionary[fieldInfo.fieldType].hasOwnView : false;
  const navigationItems = [
    {
      key: "page",
      label: "Page",
      isCurrent: false,
      onClick: () => previewStore.send({ type: "clearSelection" }),
    },
    {
      key: "block",
      label: blockDef._internal.title,
      isCurrent: ancestorChain.length === 0 && !fieldHasOwnView,
      onClick: () => previewStore.send({ type: "setFocusedBlock", blockId: block.id }),
    },
    ...ancestorChain.map((ancestor) => ({
      key: `item-${ancestor.id}`,
      label:
        (getArraySchemaForItem(blockDef._internal.contentSchema, ancestor.id, itemsMap) as any)
          ?.title ?? formatFieldName(ancestor.fieldName),
      isCurrent:
        ancestor.id === currentItemId &&
        !fieldHasOwnView &&
        ancestor.id === ancestorChain[ancestorChain.length - 1]?.id,
      onClick: () =>
        previewStore.send({
          type: "selectItem",
          blockId: block.id,
          itemId: ancestor.id,
        }),
    })),
    ...(fieldHasOwnView && fieldInfo
      ? [
          {
            key: `field-${fieldInfo.fieldName}`,
            label:
              (currentSchema as any)?.properties?.[fieldInfo.fieldName]?.title ??
              formatFieldName(fieldInfo.fieldName),
            isCurrent: true,
            onClick: undefined,
          },
        ]
      : []),
  ];
  return (
    <>
      <div className="border-border flex flex-col gap-1.5 border-b px-2 py-4">
        <nav aria-label="Selection path" className="text-muted-foreground text-sm">
          <ol className="flex flex-col">
            {navigationItems.map((item, index) => {
              const isFirstItem = index === 0;
              const isLastItem = index === navigationItems.length - 1;

              return (
                <li key={item.key} className="relative min-w-0 pl-6">
                  <svg
                    aria-hidden="true"
                    className="text-muted-foreground pointer-events-none absolute top-0 left-0 h-7 w-4"
                    fill="none"
                    preserveAspectRatio="none"
                    viewBox="0 0 16 28"
                  >
                    {!isFirstItem && (
                      <path
                        d="M8 0 V10"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        vectorEffect="non-scaling-stroke"
                      />
                    )}
                    {!isLastItem && (
                      <path
                        d="M8 18 V28"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        vectorEffect="non-scaling-stroke"
                      />
                    )}
                    <circle
                      className="fill-background"
                      cx="8"
                      cy="14"
                      r="4"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      vectorEffect="non-scaling-stroke"
                    />
                  </svg>
                  {item.onClick ? (
                    <button
                      type="button"
                      className={cn(
                        "hover:text-foreground flex h-7 min-w-0 cursor-pointer items-center truncate text-left transition-colors",
                        item.isCurrent && "text-foreground font-medium",
                      )}
                      onClick={item.onClick}
                    >
                      {item.label}
                    </button>
                  ) : (
                    <span className="text-foreground block h-7 min-w-0 truncate leading-7 font-medium">
                      {item.label}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        </nav>
      </div>
      <div className="relative flex-1 overflow-auto">
        <div>
          {isItemLoading ? (
            <div className="flex h-full items-center justify-center py-12">
              <Spinner />
            </div>
          ) : (
            <>
              {currentItemId == null && !fieldHasOwnView && settingsFields.length > 0 && (
                <div className="border-border space-y-4 border-b px-2 py-4">
                  <Label className="text-muted-foreground">Settings</Label>
                  {settingsFields.map((field) => {
                    const label = field.label ?? formatFieldName(field.name);
                    const settingsValues = (block.settings ?? {}) as Record<string, unknown>;

                    if (field.fieldType === "Enum") {
                      const value =
                        (settingsValues[field.name] as string | undefined) ??
                        (blockDef._internal.settingsSchema?.properties?.[field.name] as any)
                          ?.default ??
                        "";

                      return (
                        <div key={field.name} className="space-y-2">
                          <Label htmlFor={`setting-${field.name}`}>{label}</Label>
                          <Select
                            value={value}
                            onValueChange={(newValue) => {
                              if (!requireDraft()) return;
                              sessionDirtyRef.current = true;
                              updateSettings.mutate({
                                id: block.id,
                                settings: { [field.name]: newValue },
                              });
                            }}
                          >
                            <SelectTrigger id={`setting-${field.name}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {field.enumValues?.map((enumValue) => (
                                <SelectItem key={enumValue} value={enumValue}>
                                  {field.enumLabels?.[enumValue] ?? enumValue}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      );
                    }

                    if (field.fieldType === "Boolean") {
                      const checked =
                        (settingsValues[field.name] as boolean | undefined) ??
                        (blockDef._internal.settingsSchema?.properties?.[field.name] as any)
                          ?.default ??
                        false;

                      return (
                        <div key={field.name} className="flex items-center justify-between">
                          <Label htmlFor={`setting-${field.name}`}>{label}</Label>
                          <Switch
                            id={`setting-${field.name}`}
                            checked={checked}
                            onCheckedChange={(newValue) => {
                              if (!requireDraft()) return;
                              sessionDirtyRef.current = true;
                              updateSettings.mutate({
                                id: block.id,
                                settings: { [field.name]: newValue },
                              });
                            }}
                          />
                        </div>
                      );
                    }

                    return null;
                  })}
                </div>
              )}
              {currentItemId != null && !fieldHasOwnView && itemSettingsFields.length > 0 && (
                <div className="border-border space-y-4 border-b px-2 py-4">
                  <Label className="text-muted-foreground">Settings</Label>
                  {itemSettingsFields.map((field) => {
                    const label = field.label ?? formatFieldName(field.name);
                    const itemSettingsValues = (currentItem?.settings ?? {}) as Record<
                      string,
                      unknown
                    >;
                    const itemSettingsSchemaProps = (itemArraySchema as any)?.itemSettingsSchema
                      ?.properties as Record<string, any> | undefined;

                    if (field.fieldType === "Enum") {
                      const value =
                        (itemSettingsValues[field.name] as string | undefined) ??
                        (itemSettingsSchemaProps?.[field.name]?.default as string | undefined) ??
                        "";

                      return (
                        <div key={field.name} className="space-y-2">
                          <Label htmlFor={`item-setting-${field.name}`}>{label}</Label>
                          <Select
                            value={value}
                            onValueChange={(newValue) => {
                              if (!requireDraft()) return;
                              sessionDirtyRef.current = true;
                              updateRepeatableSettings.mutate({
                                id: currentItemId,
                                settings: { [field.name]: newValue },
                              });
                            }}
                          >
                            <SelectTrigger id={`item-setting-${field.name}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {field.enumValues?.map((enumValue) => (
                                <SelectItem key={enumValue} value={enumValue}>
                                  {field.enumLabels?.[enumValue] ?? enumValue}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      );
                    }

                    if (field.fieldType === "Boolean") {
                      const checked =
                        (itemSettingsValues[field.name] as boolean | undefined) ??
                        (itemSettingsSchemaProps?.[field.name]?.default as boolean | undefined) ??
                        false;

                      return (
                        <div key={field.name} className="flex items-center justify-between">
                          <Label htmlFor={`item-setting-${field.name}`}>{label}</Label>
                          <Switch
                            id={`item-setting-${field.name}`}
                            checked={checked}
                            onCheckedChange={(newValue) => {
                              if (!requireDraft()) return;
                              sessionDirtyRef.current = true;
                              updateRepeatableSettings.mutate({
                                id: currentItemId,
                                settings: { [field.name]: newValue },
                              });
                            }}
                          />
                        </div>
                      );
                    }

                    return null;
                  })}
                </div>
              )}
              {isViewingAsset && assetFieldName && isMultipleAsset && (
                <MultipleAssetFieldEditor
                  fieldName={assetFieldName}
                  assetType={assetType}
                  currentData={currentData}
                  onFieldChange={activeFieldChangeHandler}
                />
              )}
              {isViewingAsset && assetFieldName && !isMultipleAsset && (
                <SingleAssetFieldEditor
                  fieldName={assetFieldName}
                  assetType={assetType}
                  currentData={currentData}
                  onFieldChange={activeFieldChangeHandler}
                />
              )}
              {!isViewingAsset && isViewingLink && linkFieldName && (
                <div className="px-2 py-4">
                  <LinkFieldEditor
                    fieldName={linkFieldName}
                    linkValue={
                      (currentData[linkFieldName] as Record<string, unknown>) ??
                      ({
                        type: "external",
                        text: "",
                        href: "",
                        newTab: false,
                      } as Record<string, unknown>)
                    }
                    onSave={(fieldName, value) => {
                      activeFieldChangeHandler(fieldName, value);
                    }}
                  />
                </div>
              )}
              {!isViewingAsset && !isViewingLink && (currentItemId == null || currentItem) && (
                <ItemFieldsEditor
                  key={currentItemId ?? `block-${block.id}`}
                  schema={currentSchema}
                  data={currentData}
                  blockId={block.id}
                  itemId={currentItemId ?? undefined}
                  onFieldChange={activeFieldChangeHandler}
                  postToIframe={postToIframe}
                  filesMap={filesMap}
                  itemsMap={itemsMap}
                  fieldIdPrefix={fieldIdPrefix}
                />
              )}
              {!isViewingAsset && !isViewingLink && currentItemId != null && currentItem && (
                <div className="border-border flex items-center gap-1 border-t px-2 py-4">
                  {canAddSibling && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground justify-start"
                      onClick={() => {
                        if (!requireDraft()) return;
                        addSibling({ afterPosition: currentItem.position });
                      }}
                    >
                      <CirclePlus className="h-4 w-4" />
                      Add item
                    </Button>
                  )}
                  {canRemoveCurrent && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground justify-start"
                      onClick={() => {
                        if (!requireDraft()) return;
                        removeCurrent(currentItemId, {
                          onSuccess: () => previewStore.send({ type: "selectParent" }),
                        });
                      }}
                    >
                      <CircleMinus className="h-4 w-4" />
                      Remove item
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground justify-start"
                    onClick={() => previewStore.send({ type: "selectParent" })}
                  >
                    <CornerLeftUp className="h-4 w-4" />
                    Select parent
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
};

export { PageEditorSidebar };
