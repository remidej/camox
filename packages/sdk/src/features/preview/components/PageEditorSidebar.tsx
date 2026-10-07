import { Button } from "@camox/ui/button";
import { ButtonGroup } from "@camox/ui/button-group";
import { Label } from "@camox/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@camox/ui/select";
import { Spinner } from "@camox/ui/spinner";
import { Switch } from "@camox/ui/switch";
import { useMutation, useQueries, useQuery } from "@tanstack/react-query";
import { useSelector } from "@xstate/store-react";
import { CirclePlus, Trash2 } from "lucide-react";
import * as React from "react";

import { useRequireDraftSource } from "@/core/hooks/useRequireDraftSource";
import { fieldTypesDictionary, type FieldType } from "@/core/lib/fieldTypes";
import { useProjectSlug } from "@/lib/auth";
import { isFileMarker, type NormalizedItem } from "@/lib/normalized-data";
import {
  blockMutations,
  blockQueries,
  collectionQueries,
  fileQueries,
  repeatableItemMutations,
} from "@/lib/queries";
import { cn } from "@/lib/utils";

import { useCamoxApp } from "../../provider/components/CamoxAppContext";
import { selectionHoverMessage, type OverlayMessage } from "../overlayMessages";
import { PreviewEditingOwnerContext } from "../previewSelection";
import {
  previewStore,
  selectionBlockId,
  selectionField,
  selectionItemId,
  selectionForOwner,
  type EditingOwner,
  type Selection,
} from "../previewStore";
import { SingleAssetFieldEditor } from "./AssetFieldEditor";
import { AttachedComments } from "./AttachedComments";
import { type FieldWriteTarget, useFieldWriter } from "./fieldWriteTarget";
import { type SchemaField, formatFieldName } from "./ItemFieldsEditor";
import { ItemFieldsEditor } from "./ItemFieldsEditor";
import { LinkFieldEditor } from "./LinkFieldEditor";
import { MultipleAssetFieldEditor } from "./MultipleAssetFieldEditor";
import { PageStatusBadge } from "./PageStatusBadge";
import { SidebarSection, SidebarSectionHeader, SidebarSectionContent } from "./SidebarSection";
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
  const owner = React.useContext(PreviewEditingOwnerContext);
  if (owner == null) return null;
  return <PageEditorSidebarContent owner={owner} />;
};

const PageEditorSidebarContent = ({ owner }: { owner: EditingOwner }) => {
  const pageId = owner.kind === "page" ? owner.pageId : undefined;
  const camoxApp = useCamoxApp();
  const projectSlug = useProjectSlug();
  const updateSettings = useMutation(blockMutations.updateSettings());
  const updateRepeatableSettings = useMutation(repeatableItemMutations.updateSettings());
  const requireDraft = useRequireDraftSource();

  // Get state from store
  const selection = useSelector(previewStore, (state) => selectionForOwner(state.context, owner));
  const iframeElement = useSelector(previewStore, (state) => state.context.iframeElement);

  const postToIframe = React.useCallback(
    (message: OverlayMessage) => {
      if (!iframeElement?.contentWindow) return;
      iframeElement.contentWindow.postMessage(message, "*");
    },
    [iframeElement],
  );

  const [hoveredBreadcrumb, setHoveredBreadcrumb] = React.useState<{
    target: Selection | null;
    selection: Selection | null;
  } | null>(null);
  React.useEffect(() => {
    if (!hoveredBreadcrumb || hoveredBreadcrumb.selection !== selection) return;
    postToIframe(selectionHoverMessage(hoveredBreadcrumb.target, true));
    return () => postToIframe(selectionHoverMessage(hoveredBreadcrumb.target, false));
  }, [hoveredBreadcrumb, postToIframe, selection]);

  const blockId = selectionBlockId(selection);
  const currentItemId = selectionItemId(selection);

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

  // A placed collection record is edited only while the reference still links it.
  const recordSelection =
    selection?.type === "record" || selection?.type === "record-field" ? selection : null;
  const referenceFieldName = recordSelection?.fieldName;
  const referenceCollectionId = referenceFieldName
    ? ((blockDef?._internal.contentSchema as any)?.properties?.[referenceFieldName]
        ?.collectionId as string | undefined)
    : undefined;
  const recordCollection = referenceCollectionId
    ? camoxApp.getCollectionById(referenceCollectionId)
    : undefined;
  const placedRecord = referenceFieldName ? block?.references?.[referenceFieldName] : undefined;
  const isStaleRecordSelection =
    recordSelection != null &&
    block != null &&
    ((block.content as Record<string, unknown> | undefined)?.[recordSelection.fieldName] !==
      recordSelection.recordId ||
      placedRecord?.id !== recordSelection.recordId);
  const recordView =
    recordSelection && !isStaleRecordSelection && placedRecord && recordCollection
      ? { selection: recordSelection, record: placedRecord, collection: recordCollection }
      : null;
  const recordBlockId = recordSelection?.blockId;
  const referenceFieldSelection = React.useMemo<Selection | null>(
    () =>
      recordBlockId != null && referenceFieldName
        ? {
            type: "block-field",
            blockId: recordBlockId,
            fieldName: referenceFieldName,
            fieldType: "Reference",
          }
        : null,
    [recordBlockId, referenceFieldName],
  );
  // An unlinked or replaced record falls back to the reference field view.
  const viewSelection = isStaleRecordSelection ? referenceFieldSelection : selection;
  React.useEffect(() => {
    if (!isStaleRecordSelection || !referenceFieldSelection) return;
    previewStore.send({ type: "selectTarget", ...owner, selection: referenceFieldSelection });
  }, [isStaleRecordSelection, referenceFieldSelection, owner]);

  const placedRecordId = recordView?.record.id;
  const { data: recordStatus } = useQuery({
    ...collectionQueries.records(projectSlug, referenceCollectionId ?? ""),
    enabled: placedRecordId != null,
    select: (records) => records.find((record) => record.id === placedRecordId)?.status,
  });

  const selectedField =
    recordView?.selection.type === "record-field"
      ? {
          fieldName: recordView.selection.recordFieldName,
          fieldType: recordView.selection.recordFieldType,
        }
      : selectionField(viewSelection);

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
  const recordSchema = recordView?.collection._internal.contentSchema;
  const currentSchema = React.useMemo(() => {
    if (recordSchema) return recordSchema;
    if (!blockDef) return null;
    if (currentItemId == null) return blockDef._internal.contentSchema;
    return getSchemaForItem(blockDef._internal.contentSchema, currentItemId, itemsMap);
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
    blockId: block?.id ?? -1,
    fieldName: currentItem?.fieldName ?? "",
    parentItemId: currentItem?.parentItemId ?? null,
    arraySchema: itemArraySchema as RepeatableArraySchema | null,
    siblingCount,
  });

  const recordContent = recordView?.record.content;
  const rawCurrentData: Record<string, unknown> = currentItem
    ? (currentItem.content as Record<string, unknown>)
    : (block?.content ?? {});

  // Resolve _fileId markers in data for asset field editors (recursive for inline arrays)
  const currentData = React.useMemo(() => {
    // Record assets are already resolved snapshots, not block file markers.
    if (recordContent) return recordContent;
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
  }, [recordContent, rawCurrentData, filesMap]);

  // Detect terminal field view
  const fieldInfo = selectedField
    ? {
        ...selectedField,
        fieldType:
          ((currentSchema as any)?.properties?.[selectedField.fieldName]?.fieldType as
            | FieldType
            | undefined) ?? selectedField.fieldType,
      }
    : null;
  const isViewingLink = fieldInfo?.fieldType === "Link";
  const linkFieldName = isViewingLink ? fieldInfo.fieldName : null;

  const isViewingImage = fieldInfo?.fieldType === "Image" || fieldInfo?.fieldType === "ImageList";
  const imageFieldName = isViewingImage ? fieldInfo.fieldName : null;

  const isViewingFile = fieldInfo?.fieldType === "File" || fieldInfo?.fieldType === "FileList";
  const fileFieldName = isViewingFile ? fieldInfo.fieldName : null;

  // Record asset field views arrive with record asset editing (#128).
  const isViewingRecordAsset = recordView != null && (isViewingImage || isViewingFile);
  const isViewingAsset = !recordView && (isViewingImage || isViewingFile);
  const assetFieldName = imageFieldName ?? fileFieldName;
  const assetType: "Image" | "File" = isViewingImage ? "Image" : "File";

  const isMultipleAsset = React.useMemo(() => {
    if (!isViewingAsset || !assetFieldName) return false;
    const prop = (currentSchema as any)?.properties?.[assetFieldName];
    return prop?.fieldType === "ImageList" || prop?.fieldType === "FileList";
  }, [isViewingAsset, assetFieldName, currentSchema]);

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

  if (!block || !blockDef || !currentSchema) {
    return (
      <div className="text-muted-foreground flex flex-1 items-center justify-center px-2 text-sm">
        <Spinner className="mr-2 size-3.5" /> Loading block...
      </div>
    );
  }

  const fieldHasOwnView = fieldInfo ? fieldTypesDictionary[fieldInfo.fieldType].hasOwnView : false;
  const navigationItems: {
    key: string;
    label: string;
    isCurrent: boolean;
    onClick?: () => void;
    hoverTarget?: Selection | null;
    className?: string;
  }[] = [
    {
      key: "page",
      hoverTarget: null,
      label: owner.kind === "page" ? "Page" : "Layout",
      isCurrent: false,
      onClick: () => previewStore.send({ type: "clearSelection" }),
    },
    {
      key: "block",
      label: blockDef._internal.title,
      isCurrent: ancestorChain.length === 0 && !fieldHasOwnView && !recordView,
      onClick: () => previewStore.send({ type: "setFocusedBlock", ...owner, blockId: block.id }),
      hoverTarget: { type: "block", blockId: block.id },
    },
    ...ancestorChain.flatMap((ancestor) => [
      {
        key: `repeater-${ancestor.id}`,
        label:
          (getArraySchemaForItem(blockDef._internal.contentSchema, ancestor.id, itemsMap) as any)
            ?.title ?? formatFieldName(ancestor.fieldName),
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
        label: ancestor.summary || "Item",
        hoverTarget: { type: "item" as const, blockId: block.id, itemId: ancestor.id },
        isCurrent:
          ancestor.id === currentItemId &&
          !fieldHasOwnView &&
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
    ...(recordView
      ? [
          {
            key: "reference-field",
            label:
              (blockDef._internal.contentSchema as any)?.properties?.[
                recordView.selection.fieldName
              ]?.title ?? formatFieldName(recordView.selection.fieldName),
            isCurrent: false,
            hoverTarget: referenceFieldSelection,
            onClick: () =>
              previewStore.send({
                type: "selectTarget",
                ...owner,
                selection: referenceFieldSelection,
              }),
          },
          {
            key: "record",
            label: recordView.record.label,
            isCurrent: !fieldHasOwnView,
            className: "text-purple-700 dark:text-purple-400",
            hoverTarget: {
              type: "record" as const,
              blockId: block.id,
              fieldName: recordView.selection.fieldName,
              recordId: recordView.record.id,
            },
            onClick: fieldHasOwnView
              ? () =>
                  previewStore.send({
                    type: "selectRecord",
                    ...owner,
                    blockId: block.id,
                    fieldName: recordView.selection.fieldName,
                    recordId: recordView.record.id,
                  })
              : undefined,
          },
        ]
      : []),
    ...(fieldHasOwnView && fieldInfo
      ? [
          {
            key: `field-${fieldInfo.fieldName}`,
            label:
              (currentSchema as any)?.properties?.[fieldInfo.fieldName]?.title ??
              formatFieldName(fieldInfo.fieldName),
            isCurrent: true,
            onClick: undefined,
            hoverTarget: selection ?? undefined,
          },
        ]
      : []),
  ];
  return (
    <>
      <SidebarSection divider="bottom">
        <nav aria-label="Selection path" className="text-muted-foreground text-sm">
          <ol className="flex flex-col">
            {navigationItems.map((item, index) => {
              const isFirstItem = index === 0;
              const isLastItem = index === navigationItems.length - 1;

              return (
                <li
                  key={item.key}
                  className="relative min-w-0 pl-6"
                  onMouseEnter={() =>
                    setHoveredBreadcrumb(
                      !item.isCurrent && item.hoverTarget !== undefined
                        ? { target: item.hoverTarget, selection }
                        : null,
                    )
                  }
                  onMouseLeave={() => setHoveredBreadcrumb(null)}
                  onClickCapture={() => setHoveredBreadcrumb(null)}
                >
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
                        item.className,
                      )}
                      onClick={item.onClick}
                    >
                      {item.label}
                    </button>
                  ) : (
                    <span
                      className={cn(
                        "text-foreground block h-7 min-w-0 truncate leading-7 font-medium",
                        item.className,
                      )}
                    >
                      {item.label}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        </nav>
      </SidebarSection>
      <div className="relative min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
        <div>
          {isItemLoading ? (
            <div className="flex h-full items-center justify-center py-12">
              <Spinner />
            </div>
          ) : (
            <>
              {!fieldHasOwnView && currentItemId != null && currentItem && (
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
                          if (!canAddSibling || !requireDraft()) return;
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
                          if (!canRemoveCurrent || !requireDraft()) return;
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
              {recordView && !fieldHasOwnView && (
                <SidebarSection divider="bottom" aria-label="Shared record">
                  <div data-shared-record className="space-y-1 px-2 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-purple-700 dark:text-purple-400">
                        Shared · {recordView.collection._internal.title}
                      </p>
                      {recordStatus && <PageStatusBadge status={recordStatus} size="sm" />}
                    </div>
                    <p className="text-muted-foreground text-xs">
                      Edits apply everywhere this record is used.
                    </p>
                  </div>
                </SidebarSection>
              )}
              {currentItemId == null &&
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
              {currentItemId != null && !fieldHasOwnView && itemSettingsFields.length > 0 && (
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
                          (itemSettingsSchemaProps?.[field.name]?.default as string | undefined) ??
                          "";

                        return (
                          <div key={field.name} className="space-y-2">
                            <Label htmlFor={`item-setting-${field.name}`}>{label}</Label>
                            <Select
                              value={value}
                              onValueChange={(newValue) => {
                                if (!requireDraft()) return;
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
                />
              )}
              {isViewingAsset && assetFieldName && !isMultipleAsset && (
                <SingleAssetFieldEditor
                  fieldName={assetFieldName}
                  assetType={assetType}
                  currentData={currentData}
                  onFieldChange={writeField}
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
              {!isViewingAsset &&
                !isViewingRecordAsset &&
                !isViewingLink &&
                (currentItemId == null || currentItem) && (
                  <ItemFieldsEditor
                    key={`${block.id}-${recordView ? `record-${recordView.record.id}` : (currentItemId ?? "block")}-${fieldInfo?.fieldName ?? "fields"}`}
                    selectedFieldName={fieldInfo?.fieldName}
                    schema={currentSchema}
                    data={currentData}
                    blockId={block.id}
                    itemId={currentItemId ?? undefined}
                    onFieldChange={writeField}
                    postToIframe={postToIframe}
                    filesMap={filesMap}
                    itemsMap={itemsMap}
                    references={currentItemId == null && !recordView ? block.references : undefined}
                    placement={
                      recordView
                        ? {
                            fieldName: recordView.selection.fieldName,
                            recordId: recordView.record.id,
                          }
                        : undefined
                    }
                    fieldIdPrefix={fieldIdPrefix}
                  />
                )}
              {!recordView && !fieldInfo && (currentItemId == null || currentItem) && (
                <AttachedComments
                  pageId={pageId}
                  blockId={block.id}
                  itemId={currentItemId ?? undefined}
                />
              )}
              {!recordView && fieldInfo && (
                <AttachedComments
                  pageId={pageId}
                  blockId={block.id}
                  itemId={currentItemId ?? undefined}
                  fieldName={fieldInfo.fieldName}
                  fieldType={fieldInfo.fieldType}
                />
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
};

export { PageEditorSidebar };
