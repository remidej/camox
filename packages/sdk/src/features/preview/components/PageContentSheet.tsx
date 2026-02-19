import * as React from "react";
import { useMutation } from "convex/react";
import { useSelector } from "@xstate/store/react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { PreviewSideSheet, SheetParts } from "./PreviewSideSheet";
import { api } from "camox/_generated/api";
import { Doc, Id } from "camox/_generated/dataModel";
import { useCamoxApp } from "../../provider/components/CamoxAppContext";
import { previewStore, type SelectionBreadcrumb } from "../previewStore";
import { usePreviewedPage } from "../CamoxPreview";
import type { OverlayMessage } from "../overlayMessages";
import { actionsStore, type Action } from "@/features/provider/actionsStore";
import { type SchemaField, formatFieldName } from "./ItemFieldsEditor";
import { ItemFieldsEditor } from "./ItemFieldsEditor";

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
 * Schema/data traversal helpers
 * -----------------------------------------------------------------------------------------------*/

/**
 * Walks the content schema down through RepeatableObject breadcrumbs
 * to get the sub-schema at the current depth.
 */
const getSchemaAtDepth = (
  contentSchema: unknown,
  breadcrumbs: SelectionBreadcrumb[],
): unknown => {
  let schema = contentSchema;
  for (const crumb of breadcrumbs) {
    if (crumb.type !== "RepeatableObject" || !crumb.fieldName) continue;
    const prop = (schema as any)?.properties?.[crumb.fieldName];
    if (!prop?.items) return null;
    schema = prop.items;
  }
  return schema;
};

/**
 * Walks through content arrays to find the current item's data.
 * Returns the data object and the deepest item's ID.
 */
const getDataAtDepth = (
  blockContent: Record<string, unknown>,
  breadcrumbs: SelectionBreadcrumb[],
): { data: Record<string, unknown>; itemId: string } | null => {
  let currentData: Record<string, unknown> = blockContent;
  let lastItemId = "";

  for (const crumb of breadcrumbs) {
    if (crumb.type !== "RepeatableObject" || !crumb.fieldName) continue;

    const items = currentData[crumb.fieldName] as any[] | undefined;
    if (!items) return null;

    const item = items.find((i) => i._id === crumb.id);
    if (!item) return null;

    lastItemId = crumb.id;
    currentData = item.content as Record<string, unknown>;
  }

  if (!lastItemId) return null;
  return { data: currentData, itemId: lastItemId };
};

/* -------------------------------------------------------------------------------------------------
 * Helper: Find item by ID in block content
 * -----------------------------------------------------------------------------------------------*/

function findItemById(
  blockContent: Record<string, unknown>,
  breadcrumbs: SelectionBreadcrumb[],
  targetId: string,
): Doc<"repeatableItems"> | null {
  let currentData: Record<string, unknown> = blockContent;

  for (const crumb of breadcrumbs) {
    if (crumb.type !== "RepeatableObject" || !crumb.fieldName) continue;

    const items = currentData[crumb.fieldName] as any[] | undefined;
    if (!items) return null;

    const item = items.find((i) => i._id === crumb.id);
    if (!item) return null;

    if (crumb.id === targetId) return item as Doc<"repeatableItems">;

    currentData = item.content as Record<string, unknown>;
  }

  return null;
}

/* -------------------------------------------------------------------------------------------------
 * PageContentSheet
 * -----------------------------------------------------------------------------------------------*/

const PageContentSheet = () => {
  const camoxApp = useCamoxApp();
  const updateBlockContent = useMutation(api.blocks.updateBlockContent);
  const updateBlockSettings = useMutation(api.blocks.updateBlockSettings);
  const updateRepeatableItemContent = useMutation(
    api.repeatableItems.updateRepeatableItemContent,
  );

  // Get state from store
  const isOpen = useSelector(
    previewStore,
    (state) => state.context.isPageContentSheetOpen,
  );
  const selectionBreadcrumbs = useSelector(
    previewStore,
    (state) => state.context.selectionBreadcrumbs,
  );
  const iframeElement = useSelector(
    previewStore,
    (state) => state.context.iframeElement,
  );

  const postToIframe = React.useCallback(
    (message: OverlayMessage) => {
      if (!iframeElement?.contentWindow) return;
      iframeElement.contentWindow.postMessage(message, "*");
    },
    [iframeElement],
  );

  // Find the Block breadcrumb (always the first one)
  const blockBreadcrumb =
    selectionBreadcrumbs[0]?.type === "Block" ? selectionBreadcrumbs[0] : null;
  const blockId = blockBreadcrumb?.id as Id<"blocks"> | undefined;

  // RepeatableObject breadcrumbs (everything after the block)
  const repeatableBreadcrumbs = selectionBreadcrumbs.filter(
    (b) => b.type === "RepeatableObject",
  );
  const depth = repeatableBreadcrumbs.length;

  // Look up the actual block document from page data
  const page = usePreviewedPage();
  const block = blockId ? page?.blocks.find((b) => b._id === blockId) : null;

  // Get block definition
  const blockDef = block ? camoxApp.getBlockById(block.type) : null;

  const settingsFields = React.useMemo(() => {
    return blockDef ? getSettingsFields(blockDef.settingsSchema) : [];
  }, [blockDef]);

  // Compute schema and data at the current breadcrumb depth
  const currentSchema = React.useMemo(() => {
    if (!blockDef) return null;
    return getSchemaAtDepth(blockDef.contentSchema, repeatableBreadcrumbs);
  }, [blockDef, repeatableBreadcrumbs]);

  const currentDepthResult = React.useMemo(() => {
    if (!block || depth === 0) return null;
    return getDataAtDepth(block.content, repeatableBreadcrumbs);
  }, [block, depth, repeatableBreadcrumbs]);

  const currentData: Record<string, unknown> =
    depth === 0 ? (block?.content ?? {}) : (currentDepthResult?.data ?? {});

  const currentItemId = currentDepthResult?.itemId as
    | Id<"repeatableItems">
    | undefined;

  // Auto-focus selected field when sheet opens
  const selectedFieldName =
    selectionBreadcrumbs.length === 2 &&
    selectionBreadcrumbs[1]?.type !== "Block" &&
    selectionBreadcrumbs[1]?.type !== "RepeatableObject"
      ? selectionBreadcrumbs[1]?.id
      : null;

  const handleOpenAutoFocus = React.useCallback(
    (e: Event) => {
      e.preventDefault();
      if (!selectedFieldName) return;
      setTimeout(() => {
        const element = document.getElementById(
          selectedFieldName,
        ) as HTMLTextAreaElement | null;
        if (!element) return;
        element.focus();
        element.select();
      }, 100);
    },
    [selectedFieldName],
  );

  // Register action to toggle content sheet for current selection
  React.useEffect(() => {
    const action: Action = {
      id: "open-content-sheet",
      label: isOpen ? "Close content sheet" : "Open content sheet",
      groupLabel: "Preview",
      icon: "PanelLeft",
      shortcut: { key: "j", withMeta: true },
      checkIfAvailable: () => isOpen || !!blockId,
      execute: () => {
        if (!blockId) return;
        previewStore.send({ type: "toggleContentSheet" });
      },
    };

    actionsStore.send({ type: "registerAction", action });
    return () => actionsStore.send({ type: "unregisterAction", id: action.id });
  }, [blockId, isOpen]);

  const handleBlockFieldChange = React.useCallback(
    (fieldName: string, value: unknown) => {
      if (!block) return;
      updateBlockContent({
        blockId: block._id,
        content: { [fieldName]: value },
      });
    },
    [block, updateBlockContent],
  );

  const handleItemFieldChange = React.useCallback(
    (fieldName: string, value: unknown) => {
      if (!currentItemId) return;
      updateRepeatableItemContent({
        itemId: currentItemId,
        content: { [fieldName]: value },
      });
    },
    [currentItemId, updateRepeatableItemContent],
  );

  const handleOpenChange = (open: boolean) => {
    if (open) return;
    if (block && selectedFieldName) {
      const fieldId = currentItemId
        ? `${block._id}__${currentItemId}__${selectedFieldName}`
        : `${block._id}__${selectedFieldName}`;
      postToIframe({ type: "CAMOX_FOCUS_FIELD_END", fieldId });
    }
    // Clear any lingering hover/focus overlays for the current item
    if (block && currentItemId) {
      postToIframe({
        type: "CAMOX_HOVER_REPEATER_ITEM_END",
        blockId: block._id,
        itemId: currentItemId,
      });
    }
    previewStore.send({ type: "closeBlockContentSheet" });
  };

  if (!block || !blockDef || !currentSchema) {
    return null;
  }

  // Build breadcrumb label for each RepeatableObject crumb
  const getBreadcrumbLabel = (
    crumb: SelectionBreadcrumb,
    schema: unknown,
  ): string => {
    if (!crumb.fieldName) return crumb.id;
    const prop = (schema as any)?.properties?.[crumb.fieldName];
    const fieldLabel = prop?.title ?? formatFieldName(crumb.fieldName);

    // Try to find the item summary from block content
    const item = findItemById(block.content, selectionBreadcrumbs, crumb.id);
    if (item?.summary) return item.summary;
    return fieldLabel;
  };

  return (
    <PreviewSideSheet
      open={isOpen}
      onOpenChange={handleOpenChange}
      onOpenAutoFocus={handleOpenAutoFocus}
      className="flex flex-col gap-0"
    >
      <SheetParts.SheetHeader className="border-b border-border">
        <SheetParts.SheetTitle>{block.summary}</SheetParts.SheetTitle>
        <SheetParts.SheetDescription>
          <Breadcrumb>
            <BreadcrumbList className="flex-nowrap">
              <BreadcrumbItem className="min-w-0">
                {depth === 0 ? (
                  <BreadcrumbPage className="truncate">
                    {blockDef.title}
                  </BreadcrumbPage>
                ) : (
                  <BreadcrumbLink
                    className="cursor-pointer"
                    onClick={() =>
                      previewStore.send({
                        type: "navigateBreadcrumb",
                        depth: 0,
                      })
                    }
                  >
                    {blockDef.title}
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
              {depth > 0 && (
                <>
                  {repeatableBreadcrumbs.length > 1 && (
                    <>
                      <BreadcrumbSeparator />
                      <BreadcrumbItem>
                        <BreadcrumbEllipsis />
                      </BreadcrumbItem>
                    </>
                  )}
                  <BreadcrumbSeparator />
                  {(() => {
                    const lastCrumb =
                      repeatableBreadcrumbs[repeatableBreadcrumbs.length - 1];
                    const parentSchema = getSchemaAtDepth(
                      blockDef.contentSchema,
                      repeatableBreadcrumbs.slice(0, -1),
                    );
                    const crumbLabel = getBreadcrumbLabel(
                      lastCrumb,
                      parentSchema,
                    );
                    return (
                      <BreadcrumbItem className="min-w-0">
                        <BreadcrumbPage className="truncate">
                          {crumbLabel}
                        </BreadcrumbPage>
                      </BreadcrumbItem>
                    );
                  })()}
                </>
              )}
            </BreadcrumbList>
          </Breadcrumb>
        </SheetParts.SheetDescription>
      </SheetParts.SheetHeader>
      <div className="flex-1 overflow-auto">
        <ItemFieldsEditor
          schema={currentSchema}
          data={currentData}
          blockId={block._id}
          itemId={currentItemId}
          onFieldChange={
            depth === 0 ? handleBlockFieldChange : handleItemFieldChange
          }
          postToIframe={postToIframe}
        />
        {depth === 0 && settingsFields.length > 0 && (
          <div className="space-y-4 py-4 px-4 border-t border-border">
            <Label className="text-muted-foreground">Settings</Label>
            {settingsFields.map((field) => {
              const label = field.label ?? formatFieldName(field.name);
              const settingsValues = (block.settings ?? {}) as Record<
                string,
                unknown
              >;

              if (field.fieldType === "Enum") {
                const value =
                  (settingsValues[field.name] as string | undefined) ??
                  (blockDef.settingsSchema?.properties?.[field.name] as any)
                    ?.default ??
                  "";

                return (
                  <div key={field.name} className="space-y-2">
                    <Label htmlFor={`setting-${field.name}`}>{label}</Label>
                    <Select
                      value={value}
                      onValueChange={(newValue) => {
                        updateBlockSettings({
                          blockId: block._id,
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
                  (blockDef.settingsSchema?.properties?.[field.name] as any)
                    ?.default ??
                  false;

                return (
                  <div
                    key={field.name}
                    className="flex items-center justify-between"
                  >
                    <Label htmlFor={`setting-${field.name}`}>{label}</Label>
                    <Switch
                      id={`setting-${field.name}`}
                      checked={checked}
                      onCheckedChange={(newValue) => {
                        updateBlockSettings({
                          blockId: block._id,
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
      </div>
    </PreviewSideSheet>
  );
};

export { PageContentSheet };
