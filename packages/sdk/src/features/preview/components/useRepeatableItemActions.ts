import { useMutation } from "@tanstack/react-query";
import { generateKeyBetween } from "fractional-indexing";
import * as React from "react";

import { repeatableItemMutations } from "@/lib/queries";

import { PreviewEditingOwnerContext } from "../previewSelection";
import { previewStore, sameEditingOwner } from "../previewStore";

export type RepeatableItemFieldSchema = {
  type?: string;
  fieldType?: string;
  default?: unknown;
  defaultItems?: number;
  minItems?: number;
  defaultItemSettings?: Record<string, unknown>;
  items?: { properties?: Record<string, RepeatableItemFieldSchema> };
};

export type RepeatableArraySchema = {
  type?: "array";
  maxItems?: number;
  minItems?: number;
  defaultItemSettings?: Record<string, unknown>;
  items?: { properties?: Record<string, RepeatableItemFieldSchema> };
};

type NestedItemSeed = {
  tempId: string;
  parentTempId: string | null;
  fieldName: string;
  content: Record<string, unknown>;
  settings?: Record<string, unknown>;
  position: string;
};

const buildDefaultContent = (
  itemProperties: Record<string, RepeatableItemFieldSchema> | undefined,
): Record<string, unknown> => {
  const content: Record<string, unknown> = {};
  if (!itemProperties) return content;
  for (const [key, prop] of Object.entries(itemProperties)) {
    if (prop.fieldType === "Image" || prop.fieldType === "File") continue;
    if (prop.type === "array" && prop.items?.properties) continue;
    if ("default" in prop) {
      content[key] = prop.default;
    }
  }
  return content;
};

const buildNestedItemSeeds = (
  itemProperties: Record<string, RepeatableItemFieldSchema> | undefined,
): NestedItemSeed[] => {
  const seeds: NestedItemSeed[] = [];
  if (!itemProperties) return seeds;

  let counter = 0;
  const recurse = (
    properties: Record<string, RepeatableItemFieldSchema>,
    parentTempId: string | null,
  ) => {
    for (const [fieldName, fieldSchema] of Object.entries(properties)) {
      if (fieldSchema.type !== "array" || !fieldSchema.items?.properties) continue;
      // Asset list arrays are stored inline as _fileId markers, not as nested
      // DB items. The runtime synthesizes default placeholders when empty.
      if (fieldSchema.fieldType === "ImageList" || fieldSchema.fieldType === "FileList") continue;
      const defaultCount = fieldSchema.defaultItems ?? fieldSchema.minItems ?? 0;
      if (defaultCount <= 0) continue;

      const nestedItemProps = fieldSchema.items.properties;
      const nestedContent = buildDefaultContent(nestedItemProps);
      const nestedSettingsDefaults = fieldSchema.defaultItemSettings;

      let prevPos: string | null = null;
      for (let i = 0; i < defaultCount; i++) {
        const tempId = `nested_${++counter}`;
        const position = generateKeyBetween(prevPos, null);
        prevPos = position;
        seeds.push({
          tempId,
          parentTempId,
          fieldName,
          content: { ...nestedContent },
          settings: nestedSettingsDefaults ? { ...nestedSettingsDefaults } : undefined,
          position,
        });
        recurse(nestedItemProps, tempId);
      }
    }
  };

  recurse(itemProperties, null);
  return seeds;
};

type UseRepeatableItemActionsArgs = {
  blockId: string;
  fieldName: string;
  parentItemId?: string | null;
  arraySchema: RepeatableArraySchema | null;
  siblingCount: number;
};

type AddItemOptions = { afterPosition?: string };

export const useRepeatableItemActions = ({
  blockId,
  fieldName,
  parentItemId,
  arraySchema,
  siblingCount,
}: UseRepeatableItemActionsArgs) => {
  const owner = React.useContext(PreviewEditingOwnerContext);
  const createRepeatableItem = useMutation(repeatableItemMutations.create());
  const deleteRepeatableItem = useMutation(repeatableItemMutations.delete());

  const canAdd =
    arraySchema != null &&
    (arraySchema.maxItems === undefined || siblingCount < arraySchema.maxItems);
  const canRemove =
    arraySchema != null &&
    (arraySchema.minItems === undefined || siblingCount > arraySchema.minItems);

  const addItem = (options?: AddItemOptions) => {
    if (owner === null) return;
    if (!arraySchema) return;
    const itemsSchema = arraySchema.items;
    const defaultContent = buildDefaultContent(itemsSchema?.properties);
    const defaultSettings = arraySchema.defaultItemSettings;
    const nestedItems = buildNestedItemSeeds(itemsSchema?.properties);

    createRepeatableItem.mutate(
      {
        blockId,
        parentItemId: parentItemId ?? undefined,
        fieldName,
        content: defaultContent,
        settings: defaultSettings ? { ...defaultSettings } : undefined,
        nestedItems: nestedItems.length > 0 ? nestedItems : undefined,
        afterPosition: options?.afterPosition,
      },
      {
        onSuccess: (created) => {
          if (!sameEditingOwner(previewStore.getSnapshot().context.editingContext, owner)) return;
          previewStore.send({ type: "selectItem", ...owner, blockId, itemId: created.id });
        },
      },
    );
  };

  const removeItem = (itemId: string, options?: { onSuccess?: () => void }) => {
    deleteRepeatableItem.mutate(
      { id: itemId },
      {
        onSuccess: options?.onSuccess,
      },
    );
  };

  return { canAdd, addItem, canRemove, removeItem };
};
