import { Button } from "@camox/ui/button";
import { ButtonGroup } from "@camox/ui/button-group";
import { Label } from "@camox/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@camox/ui/select";
import { Spinner } from "@camox/ui/spinner";
import { Switch } from "@camox/ui/switch";
import { useMutation } from "@tanstack/react-query";
import { useSelector } from "@xstate/store-react";
import { CirclePlus, Ellipsis, Trash2 } from "lucide-react";
import * as React from "react";

import { fieldTypesDictionary } from "@/core/lib/fieldTypes";
import { editorAssetField } from "@/features/content/collection-form";
import { isFileMarker, type NormalizedItem } from "@/lib/normalized-data";
import { blockMutations, repeatableItemMutations } from "@/lib/queries";
import { type BlockDefinition, useBlockDefinition } from "@/lib/studio-definitions";

import { reads, useReadQueries, useReadQuery } from "../../../lib/studio-reads";
import { useEditingFrame } from "../editingFrame";
import { entityName } from "../entityName";
import { usePageRecordPlacer } from "../pageRecord";
import { PreviewEditingOwnerContext } from "../previewSelection";
import {
  isBlockPlacement,
  NO_BLOCK_ID,
  previewStore,
  recordPlacement,
  selectionBlockId,
  selectionField,
  selectionItemId,
  selectionForOwner,
  type EditingOwner,
} from "../previewStore";
import { SingleAssetFieldEditor } from "./AssetFieldEditor";
import { contentFieldSchema } from "./contentFieldSchema";
import { type SchemaField, formatFieldName } from "./ItemFieldsEditor";
import { ItemFieldsEditor } from "./ItemFieldsEditor";
import { LinkFieldEditor } from "./LinkFieldEditor";
import { MultipleAssetFieldEditor } from "./MultipleAssetFieldEditor";
import { SidebarSection, SidebarSectionHeader, SidebarSectionContent } from "./SidebarSection";
import { SelectionViewCount, SidebarStackHeader, SidebarStackView } from "./SidebarStack";
import { type FieldWriteTarget, useFieldWriter } from "./useFieldWriter";
import { type RecordPlacer, useRecordView, type SelectionCrumb } from "./useRecordView";
import { type RepeatableArraySchema, useRepeatableItemActions } from "./useRepeatableItemActions";

const EMPTY_CONTENT: Record<string, unknown> = {};

/* -------------------------------------------------------------------------------------------------
 * Helper: Collapse the middle of a long selection path
 * -----------------------------------------------------------------------------------------------*/

/** A header in the path's stack: one step, or the steps collapsed into one, from `index` on. */
type StackRow =
  | { index: number; item: SelectionCrumb; collapsed?: undefined }
  | { index: number; collapsed: SelectionCrumb[] };

/**
 * The path's headers. The `kept` first steps, the selection and its parent always show; two or
 * more steps between them collapse into one header, which lists them.
 */
function stackRows(items: SelectionCrumb[], kept: number): StackRow[] {
  const rows = items.map((item, index): StackRow => ({ index, item }));
  const between = items.slice(kept, -2);
  if (between.length < 2) return rows;
  return [
    ...rows.slice(0, kept),
    { index: kept, collapsed: between },
    ...rows.slice(kept + between.length),
  ];
}

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
  itemId: string,
  itemsMap: Map<string, NormalizedItem>,
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
  itemId: string,
  itemsMap: Map<string, NormalizedItem>,
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
  itemId: string,
  itemsMap: Map<string, NormalizedItem>,
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
 * SelectionEditor
 * -----------------------------------------------------------------------------------------------*/

const SelectionEditor = ({
  pageCrumb = true,
}: {
  /** Whether the path starts with the page. The Canvas sidebar's page header stands for it. */
  pageCrumb?: boolean;
}) => {
  const owner = React.useContext(PreviewEditingOwnerContext);
  if (owner == null) return null;
  return <SelectionEditorContent owner={owner} pageCrumb={pageCrumb} />;
};

const SelectionEditorContent = ({
  owner,
  pageCrumb,
}: {
  owner: EditingOwner;
  pageCrumb: boolean;
}) => {
  const updateSettings = useMutation(blockMutations.updateSettings());
  const updateRepeatableSettings = useMutation(repeatableItemMutations.updateSettings());

  // Get state from store
  const selection = useSelector(previewStore, (state) => selectionForOwner(state.context, owner));
  const { send } = useEditingFrame();

  const blockId = selectionBlockId(selection);
  const currentItemId = selectionItemId(selection);

  // Look up the actual block data from individual block cache (granular caching)
  const { data: blockBundle } = useReadQuery(reads.blockBundle(blockId!), {
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

  const fileResults = useReadQueries(fileIds.map((id) => reads.file(id)));

  const filesMap = React.useMemo(() => {
    const map = new Map((blockBundle?.files ?? []).map((f) => [f.id, f]));
    for (let i = 0; i < fileIds.length; i++) {
      const data = fileResults[i]?.data;
      if (data) map.set(data.id, data);
    }
    return map;
  }, [blockBundle?.files, fileIds, fileResults]);

  // Get block definition
  const blockDef = useBlockDefinition(block?.type) ?? null;

  // A placed collection record is edited only while the reference still links it. The block,
  // or the repeatable item when one places the record, owns that reference. A record page's
  // record is placed by its layout, with no block.
  const pagePlacer = usePageRecordPlacer();
  const layoutRecordSelected =
    (selection?.type === "record" || selection?.type === "record-field") &&
    !isBlockPlacement(selection);
  const placerItem = currentItemId != null ? itemsMap.get(currentItemId) : undefined;
  const blockPlacer = React.useMemo<RecordPlacer | null>(() => {
    if (!block || !blockDef) return null;
    if (currentItemId == null) return { ...block, contentSchema: blockDef.contentSchema };
    if (!placerItem) return null;
    return {
      ...placerItem,
      contentSchema: getSchemaForItem(blockDef.contentSchema, currentItemId, itemsMap),
    };
  }, [block, blockDef, currentItemId, placerItem, itemsMap]);
  const { recordView, viewSelection, recordCrumbs } = useRecordView({
    owner,
    selection,
    placer: layoutRecordSelected ? pagePlacer : blockPlacer,
  });

  const selectedField =
    recordView?.selection.type === "record-field"
      ? {
          fieldName: recordView.selection.recordFieldName,
          fieldType: recordView.selection.recordFieldType,
        }
      : selectionField(viewSelection);

  const settingsFields = React.useMemo(() => {
    return blockDef ? getSettingsFields(blockDef.settingsSchema) : [];
  }, [blockDef]);

  const itemArraySchema = React.useMemo(() => {
    if (!blockDef || currentItemId == null) return null;
    return getArraySchemaForItem(blockDef.contentSchema, currentItemId, itemsMap);
  }, [blockDef, currentItemId, itemsMap]);

  const itemSettingsFields = React.useMemo(() => {
    return getSettingsFields((itemArraySchema as any)?.itemSettingsSchema);
  }, [itemArraySchema]);

  // Compute schema and data based on selection
  const recordSchema = recordView?.collection.contentSchema;
  // Only records reached through a reference list get the shared header.
  const recordInList = recordView?.inList === true;
  const currentSchema = React.useMemo(() => {
    if (recordSchema) return recordSchema;
    if (!blockDef) return null;
    if (currentItemId == null) return blockDef.contentSchema;
    return getSchemaForItem(blockDef.contentSchema, currentItemId, itemsMap);
  }, [recordSchema, blockDef, currentItemId, itemsMap]);

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
    blockId: block?.id ?? "",
    fieldName: currentItem?.fieldName ?? "",
    parentItemId: currentItem?.parentItemId ?? null,
    arraySchema: itemArraySchema as RepeatableArraySchema | null,
    siblingCount,
  });

  const recordContent = recordView?.record.content;
  const rawCurrentData: Record<string, unknown> = currentItem
    ? (currentItem.content as Record<string, unknown>)
    : (block?.content ?? EMPTY_CONTENT);

  // Resolve _fileId markers in data for asset field editors (recursive for inline arrays)
  const currentData = React.useMemo(() => {
    // Record assets are already resolved snapshots, not block file markers.
    if (recordContent) {
      return Object.fromEntries(
        Object.entries(recordContent).map(([key, value]) => [
          key,
          editorAssetField(contentFieldSchema(recordSchema, key)?.fieldType, value),
        ]),
      );
    }
    const resolveFile = (marker: { _fileId: string }) => {
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
  }, [recordContent, recordSchema, rawCurrentData, filesMap]);

  // Detect terminal field view
  const fieldInfo = selectedField
    ? {
        ...selectedField,
        fieldType:
          contentFieldSchema(currentSchema, selectedField.fieldName)?.fieldType ??
          selectedField.fieldType,
      }
    : null;
  const isViewingLink = fieldInfo?.fieldType === "Link";
  const linkFieldName = isViewingLink ? fieldInfo.fieldName : null;

  const isViewingImage = fieldInfo?.fieldType === "Image" || fieldInfo?.fieldType === "ImageList";
  const imageFieldName = isViewingImage ? fieldInfo.fieldName : null;

  const isViewingFile = fieldInfo?.fieldType === "File" || fieldInfo?.fieldType === "FileList";
  const fileFieldName = isViewingFile ? fieldInfo.fieldName : null;

  const isViewingAsset = isViewingImage || isViewingFile;
  const assetFieldName = imageFieldName ?? fileFieldName;
  const assetType: "Image" | "File" = isViewingImage ? "Image" : "File";

  const multipleAssetType =
    isViewingAsset && assetFieldName
      ? contentFieldSchema(currentSchema, assetFieldName)?.fieldType
      : undefined;
  const isMultipleAsset = multipleAssetType === "ImageList" || multipleAssetType === "FileList";
  // Record asset views match the collection form, which restricts uploads to the field's accept list.
  const assetProperty =
    recordView && assetFieldName ? contentFieldSchema(currentSchema, assetFieldName) : undefined;
  const assetAccept = assetProperty?.items?.accept ?? assetProperty?.accept;

  // Scope field DOM ids with useId so label-input pairs and imperative focus
  // lookups don't collide if this sheet is ever rendered more than once.
  const fieldIdPrefix = React.useId();

  const blockIdForWrites = block?.id;
  const recordForWrites = recordView?.record;
  const writeTarget = React.useMemo<FieldWriteTarget | null>(() => {
    if (recordForWrites) return { kind: "record", record: recordForWrites };
    if (blockIdForWrites == null) return null;
    if (currentItemId == null) return { kind: "block", blockId: blockIdForWrites };
    return { kind: "item", blockId: blockIdForWrites, itemId: currentItemId };
  }, [recordForWrites, blockIdForWrites, currentItemId]);
  const writeField = useFieldWriter(writeTarget, currentSchema);

  // Build selection path display from the ancestor chain
  const ancestorChain = React.useMemo(
    () => (currentItemId != null ? buildAncestorChain(currentItemId, itemsMap) : []),
    [currentItemId, itemsMap],
  );

  // A record page's record has no block: its record view is all there is.
  if (!currentSchema || (!recordView && (!block || !blockDef))) {
    return (
      <div className="text-muted-foreground flex flex-1 items-center justify-center px-2 text-sm">
        <Spinner className="mr-2 size-3.5" /> Loading block...
      </div>
    );
  }

  const fieldHasOwnView = fieldInfo ? fieldTypesDictionary[fieldInfo.fieldType].hasOwnView : false;
  /** The block and repeatable item crumbs above a selection inside a block. */
  const blockCrumbs = (
    block: NonNullable<typeof blockBundle>["block"],
    blockDef: BlockDefinition,
  ): SelectionCrumb[] => [
    {
      key: "block",
      label: blockDef.title,
      isCurrent: ancestorChain.length === 0 && !fieldHasOwnView && !recordView,
      onClick: () => previewStore.send({ type: "setFocusedBlock", ...owner, blockId: block.id }),
      hoverTarget: { type: "block", blockId: block.id },
    },
    ...ancestorChain.flatMap((ancestor) => [
      {
        key: `repeater-${ancestor.id}`,
        label:
          (getArraySchemaForItem(blockDef.contentSchema, ancestor.id, itemsMap) as any)?.title ??
          formatFieldName(ancestor.fieldName),
        isCurrent: false,
        hoverTarget: {
          type: "block-field" as const,
          blockId: block.id,
          fieldName: ancestor.fieldName,
          fieldType: "Repeater" as const,
        },
        onClick: () =>
          previewStore.send({
            type: "selectTarget",
            ...owner,
            selection:
              ancestor.parentItemId == null
                ? {
                    type: "block-field",
                    blockId: block.id,
                    fieldName: ancestor.fieldName,
                    fieldType: "Repeater",
                  }
                : {
                    type: "item-field",
                    blockId: block.id,
                    itemId: ancestor.parentItemId,
                    fieldName: ancestor.fieldName,
                    fieldType: "Repeater",
                  },
          }),
      },
      {
        key: `item-${ancestor.id}`,
        label: entityName(ancestor, "Item"),
        hoverTarget: { type: "item" as const, blockId: block.id, itemId: ancestor.id },
        isCurrent:
          ancestor.id === currentItemId &&
          !fieldHasOwnView &&
          !recordView &&
          ancestor.id === ancestorChain[ancestorChain.length - 1]?.id,
        onClick: () =>
          previewStore.send({
            type: "selectItem",
            ...owner,
            blockId: block.id,
            itemId: ancestor.id,
          }),
      },
    ]),
  ];
  const navigationItems: SelectionCrumb[] = [
    {
      key: "page",
      hoverTarget: null,
      label: owner.kind === "page" ? "Page" : "Layout",
      isCurrent: false,
      onClick: () => previewStore.send({ type: "clearSelection" }),
    },
    ...(block && blockDef ? blockCrumbs(block, blockDef) : []),
    ...recordCrumbs(fieldHasOwnView),
    ...(fieldHasOwnView && fieldInfo
      ? [
          {
            key: `field-${fieldInfo.fieldName}`,
            label:
              contentFieldSchema(currentSchema, fieldInfo.fieldName)?.title ??
              formatFieldName(fieldInfo.fieldName),
            isCurrent: true,
            onClick: undefined,
            hoverTarget: selection ?? undefined,
          },
        ]
      : []),
  ];
  const stackedItems = pageCrumb ? navigationItems : navigationItems.slice(1);
  // Under the Canvas's view, then the page's, unless the path starts with the page.
  const firstDepth = pageCrumb ? 1 : 2;
  const front = stackedItems[stackedItems.length - 1];
  const rows = stackRows(stackedItems, pageCrumb ? 1 : 0);
  return (
    <>
      {/* The path as a stack of views: the selection's on top, each step under it a header. */}
      <SelectionViewCount count={rows.length} />
      <nav aria-label="Selection path" className="shrink-0">
        <ol className="flex flex-col">
          {rows.map((row, index) => {
            const distance = rows.length - 1 - index;
            const covered = distance > 0;
            const depth = firstDepth + row.index;
            if (row.collapsed) {
              return (
                <li key="collapsed-parents" className="relative flex flex-col">
                  <SidebarStackHeader
                    depth={depth}
                    distance={distance}
                    popover={
                      <ol aria-label="Collapsed parents" className="flex flex-col">
                        {row.collapsed.map((item) => (
                          <li key={item.key} className="flex">
                            <button
                              type="button"
                              className="hover:bg-accent hover:text-accent-foreground min-w-0 flex-1 cursor-pointer truncate rounded-sm px-2 py-1.5 text-left text-sm"
                              onClick={item.onClick}
                            >
                              {item.label}
                            </button>
                          </li>
                        ))}
                      </ol>
                    }
                  >
                    <span className="flex min-w-0 items-center gap-1.5">
                      <Ellipsis className="size-3.5 shrink-0" />
                      <span className="truncate">{row.collapsed.length} parents</span>
                    </span>
                  </SidebarStackHeader>
                </li>
              );
            }
            const { item } = row;
            return (
              <li key={item.key} className="relative flex flex-col">
                <SidebarStackHeader
                  depth={depth}
                  distance={distance}
                  first={pageCrumb && row.index === 0}
                  onSelect={item.onClick}
                  hoverTarget={item.hoverTarget}
                >
                  {covered ? (
                    item.label
                  ) : (
                    <span className="truncate font-medium">{item.label}</span>
                  )}
                </SidebarStackHeader>
              </li>
            );
          })}
        </ol>
      </nav>
      <SidebarStackView
        key={`${block?.id ?? "layout"}:${front?.key}`}
        depth={firstDepth + stackedItems.length - 1}
        className="relative min-w-0 overflow-x-hidden overflow-y-auto"
      >
        <div>
          {isItemLoading ? (
            <div className="flex h-full items-center justify-center py-12">
              <Spinner />
            </div>
          ) : (
            <>
              {!fieldHasOwnView && !recordView && currentItemId != null && currentItem && (
                <SidebarSection divider="bottom" aria-label="List actions">
                  <SidebarSectionHeader>List actions</SidebarSectionHeader>
                  <SidebarSectionContent>
                    <ButtonGroup aria-label="List actions">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={!canAddSibling}
                        onClick={() => {
                          if (!canAddSibling) return;
                          addSibling({ afterPosition: currentItem.position });
                        }}
                      >
                        <CirclePlus className="text-muted-foreground h-4 w-4" />
                        Add sibling
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={!canRemoveCurrent}
                        onClick={() => {
                          if (!canRemoveCurrent) return;
                          removeCurrent(currentItemId, {
                            onSuccess: () => {
                              const selected = selectionForOwner(
                                previewStore.getSnapshot().context,
                                owner,
                              );
                              if (selectionItemId(selected) !== currentItemId) return;
                              previewStore.send({ type: "selectParent" });
                            },
                          });
                        }}
                      >
                        <Trash2 className="text-muted-foreground h-4 w-4" />
                        Delete
                      </Button>
                    </ButtonGroup>
                  </SidebarSectionContent>
                </SidebarSection>
              )}
              {recordView && !fieldHasOwnView && recordInList && (
                <SidebarSection divider="bottom" aria-label="Shared record">
                  <div data-shared-record className="space-y-1 px-2 py-3">
                    <p className="min-w-0 truncate text-sm font-medium">
                      Shared · {recordView.collection.title}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      Edits apply everywhere this record is used.
                    </p>
                  </div>
                </SidebarSection>
              )}
              {block &&
                blockDef &&
                currentItemId == null &&
                !recordView &&
                !fieldHasOwnView &&
                settingsFields.length > 0 && (
                  <SidebarSection divider="bottom" aria-label="Block settings">
                    <SidebarSectionHeader>Settings</SidebarSectionHeader>
                    <SidebarSectionContent>
                      {settingsFields.map((field) => {
                        const label = field.label ?? formatFieldName(field.name);
                        const settingsValues = (block.settings ?? {}) as Record<string, unknown>;

                        if (field.fieldType === "Enum") {
                          const value =
                            (settingsValues[field.name] as string | undefined) ??
                            (blockDef.settingsSchema?.properties?.[field.name] as any)?.default ??
                            "";

                          return (
                            <div key={field.name} className="space-y-2">
                              <Label htmlFor={`setting-${field.name}`}>{label}</Label>
                              <Select
                                value={value}
                                onValueChange={(newValue) => {
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
                            (blockDef.settingsSchema?.properties?.[field.name] as any)?.default ??
                            false;

                          return (
                            <div key={field.name} className="flex items-center justify-between">
                              <Label htmlFor={`setting-${field.name}`}>{label}</Label>
                              <Switch
                                id={`setting-${field.name}`}
                                checked={checked}
                                onCheckedChange={(newValue) => {
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
                    </SidebarSectionContent>
                  </SidebarSection>
                )}
              {currentItemId != null &&
                !recordView &&
                !fieldHasOwnView &&
                itemSettingsFields.length > 0 && (
                  <SidebarSection divider="bottom" aria-label="Item settings">
                    <SidebarSectionHeader>Settings</SidebarSectionHeader>
                    <SidebarSectionContent>
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
                            (itemSettingsSchemaProps?.[field.name]?.default as
                              | string
                              | undefined) ??
                            "";

                          return (
                            <div key={field.name} className="space-y-2">
                              <Label htmlFor={`item-setting-${field.name}`}>{label}</Label>
                              <Select
                                value={value}
                                onValueChange={(newValue) => {
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
                            (itemSettingsSchemaProps?.[field.name]?.default as
                              | boolean
                              | undefined) ??
                            false;

                          return (
                            <div key={field.name} className="flex items-center justify-between">
                              <Label htmlFor={`item-setting-${field.name}`}>{label}</Label>
                              <Switch
                                id={`item-setting-${field.name}`}
                                checked={checked}
                                onCheckedChange={(newValue) => {
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
                    </SidebarSectionContent>
                  </SidebarSection>
                )}
              {isViewingAsset && assetFieldName && isMultipleAsset && (
                <MultipleAssetFieldEditor
                  fieldName={assetFieldName}
                  assetType={assetType}
                  currentData={currentData}
                  onFieldChange={writeField}
                  resolveLocally={recordView != null}
                  offerDelete={recordView == null}
                  accept={assetAccept}
                />
              )}
              {isViewingAsset && assetFieldName && !isMultipleAsset && (
                <SingleAssetFieldEditor
                  fieldName={assetFieldName}
                  assetType={assetType}
                  currentData={currentData}
                  onFieldChange={writeField}
                  resolveLocally={recordView != null}
                  offerDelete={recordView == null}
                  accept={assetAccept}
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
                      void writeField(fieldName, value);
                    }}
                  />
                </div>
              )}
              {!isViewingAsset && !isViewingLink && (currentItemId == null || currentItem) && (
                <ItemFieldsEditor
                  key={`${block?.id ?? "layout"}-${recordView ? `record-${recordView.record.id}` : (currentItemId ?? "block")}-${fieldInfo?.fieldName ?? "fields"}`}
                  selectedFieldName={fieldInfo?.fieldName}
                  schema={currentSchema}
                  data={currentData}
                  // A record page's record is placed by no block; its placement names it.
                  blockId={block?.id ?? NO_BLOCK_ID}
                  itemId={currentItemId ?? undefined}
                  onFieldChange={writeField}
                  postToIframe={send}
                  filesMap={filesMap}
                  itemsMap={itemsMap}
                  references={
                    recordView ? recordView.record.references : (currentItem ?? block)?.references
                  }
                  placement={recordView ? recordPlacement(recordView.selection) : undefined}
                  fieldIdPrefix={fieldIdPrefix}
                />
              )}
            </>
          )}
        </div>
      </SidebarStackView>
    </>
  );
};

export { SelectionEditor };
