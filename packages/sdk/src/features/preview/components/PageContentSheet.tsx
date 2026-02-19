import * as React from "react";
import { useForm } from "@tanstack/react-form";
import { useMutation } from "convex/react";
import { useSelector } from "@xstate/store/react";
import { useLocation } from "@tanstack/react-router";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { generateKeyBetween } from "fractional-indexing";
import { GripVertical } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PreviewSideSheet, SheetParts } from "./PreviewSideSheet";
import { api } from "camox/_generated/api";
import { Doc, Id } from "camox/_generated/dataModel";
import { useCamoxApp } from "../../provider/components/CamoxAppContext";
import { previewStore } from "../previewStore";
import { usePreviewedPage } from "../CamoxPreview";
import type { OverlayMessage } from "../overlayMessages";
import { actionsStore, type Action } from "@/features/provider/actionsStore";

/* -------------------------------------------------------------------------------------------------
 * Helper: Get schema fields in order
 * -----------------------------------------------------------------------------------------------*/

interface SchemaField {
  name: string;
  fieldType: "String" | "RepeatableObject" | "Enum" | "Boolean" | "Embed" | "Link";
  label?: string;
  enumLabels?: Record<string, string>;
  enumValues?: string[];
}

const getSchemaFieldsInOrder = (schema: unknown): SchemaField[] => {
  const properties = (schema as any)?.properties;
  if (!properties) return [];

  return Object.keys(properties).map((fieldName) => {
    const prop = properties[fieldName] as any;
    return {
      name: fieldName,
      fieldType: prop.fieldType as SchemaField["fieldType"],
      label: prop.title as string | undefined,
    };
  });
};

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

const formatFieldName = (fieldName: string): string => {
  // Convert camelCase to Title Case with spaces
  return fieldName
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (str) => str.toUpperCase())
    .trim();
};

/* -------------------------------------------------------------------------------------------------
 * SortableRepeatableItem
 * -----------------------------------------------------------------------------------------------*/

interface SortableRepeatableItemProps {
  item: Doc<"repeatableItems">;
  blockId: Id<"blocks">;
}

const SortableRepeatableItem = ({
  item,
  blockId,
}: SortableRepeatableItemProps) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item._id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  // Check if this item is currently selected
  const selectionBreadcrumbs = useSelector(
    previewStore,
    (state) => state.context.selectionBreadcrumbs,
  );
  const iframeElement = useSelector(
    previewStore,
    (state) => state.context.iframeElement,
  );
  const isSelected =
    selectionBreadcrumbs.length === 2 &&
    selectionBreadcrumbs[1]?.id === item._id;

  const shouldShowHover = !isDragging && !isSelected;

  const handleMouseEnter = () => {
    if (!iframeElement?.contentWindow) return;
    const message: OverlayMessage = {
      type: "CAMOX_HOVER_REPEATER_ITEM",
      blockId,
      itemId: item._id,
    };
    iframeElement.contentWindow.postMessage(message, "*");
  };

  const handleMouseLeave = () => {
    if (!iframeElement?.contentWindow) return;
    const message: OverlayMessage = {
      type: "CAMOX_HOVER_REPEATER_ITEM_END",
      blockId,
      itemId: item._id,
    };
    iframeElement.contentWindow.postMessage(message, "*");
  };

  return (
    <li>
      <div
        ref={setNodeRef}
        style={style}
        className={cn(
          "flex flex-row justify-between items-center gap-2 px-1 py-1 max-w-full rounded-lg text-foreground transition-none group",
          shouldShowHover && "hover:bg-accent/75",
          isSelected && "bg-accent text-accent-foreground",
        )}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground flex"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </Button>

        <div className="flex items-center gap-1 flex-1 overflow-x-hidden">
          <p
            className="cursor-default flex-1 truncate py-1 text-sm"
            title={item.summary}
            onClick={() => {
              previewStore.send({
                type: "setSelectedRepeatableItem",
                blockId,
                itemId: item._id,
              });
            }}
          >
            {item.summary}
          </p>
        </div>
      </div>
    </li>
  );
};

/* -------------------------------------------------------------------------------------------------
 * RepeatableItemsList
 * -----------------------------------------------------------------------------------------------*/

interface RepeatableItemsListProps {
  items: Doc<"repeatableItems">[];
  blockId: Id<"blocks">;
}

const RepeatableItemsList = ({ items, blockId }: RepeatableItemsListProps) => {
  const { pathname } = useLocation();
  const updatePositionMutation = useMutation(
    api.repeatableItems.updateRepeatableItemPosition,
  ).withOptimisticUpdate((localStore, args) => {
    // Get the current page data
    const currentPage = localStore.getQuery(api.pages.getPage, {
      fullPath: pathname,
    });

    if (!currentPage) return;

    // Find the block containing this item
    const updatedBlocks = currentPage.blocks.map((block) => {
      // Check if this block contains the item being moved
      const hasItemInAnyField = Object.entries(block.content).some(
        ([_, value]) => {
          if (Array.isArray(value)) {
            return value.some((item) => item._id === args.itemId);
          }
          return false;
        },
      );

      if (!hasItemInAnyField) return block;

      // Update the block's content
      const updatedContent = { ...block.content };

      for (const [fieldName, fieldValue] of Object.entries(block.content)) {
        if (!Array.isArray(fieldValue)) continue;

        const items = fieldValue as Doc<"repeatableItems">[];
        const itemIndex = items.findIndex((item) => item._id === args.itemId);

        if (itemIndex === -1) continue;

        // Found the field with the item - reorder it
        const item = items[itemIndex];

        // Calculate the new position
        const newPosition = generateKeyBetween(
          args.afterPosition ?? null,
          args.beforePosition ?? null,
        );

        // Update the item's position
        const updatedItem = { ...item, position: newPosition };

        // Create new array with updated item
        const newItems = [...items];
        newItems[itemIndex] = updatedItem;

        // Re-sort the items by position
        newItems.sort((a, b) => {
          if (a.position < b.position) return -1;
          if (a.position > b.position) return 1;
          return 0;
        });

        updatedContent[fieldName] = newItems;
      }

      return {
        ...block,
        content: updatedContent,
      };
    });

    // Update the page in the local store
    localStore.setQuery(
      api.pages.getPage,
      { fullPath: pathname },
      { ...currentPage, blocks: updatedBlocks },
    );
  });

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over || active.id === over.id) {
      return;
    }

    // Find the old and new indices
    const oldIndex = items.findIndex((item) => item._id === active.id);
    const newIndex = items.findIndex((item) => item._id === over.id);

    if (oldIndex === -1 || newIndex === -1) {
      return;
    }

    // Determine afterPosition and beforePosition based on new index
    // When dragging down (oldIndex < newIndex), the item is inserted after newIndex
    // When dragging up (oldIndex > newIndex), the item is inserted before newIndex
    let afterPosition: string | undefined;
    let beforePosition: string | undefined;

    if (oldIndex < newIndex) {
      // Dragging down: insert after the target position
      afterPosition = items[newIndex].position;
      beforePosition =
        newIndex < items.length - 1 ? items[newIndex + 1].position : undefined;
    } else {
      // Dragging up: insert before the target position
      afterPosition = newIndex > 0 ? items[newIndex - 1].position : undefined;
      beforePosition = items[newIndex].position;
    }

    await updatePositionMutation({
      itemId: active.id as Id<"repeatableItems">,
      afterPosition,
      beforePosition,
    });
  };

  if (items.length === 0) return null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
      modifiers={[restrictToVerticalAxis]}
    >
      <SortableContext
        items={items.map((item) => item._id)}
        strategy={verticalListSortingStrategy}
      >
        <ul className="flex flex-col gap-1">
          {items.map((item) => (
            <SortableRepeatableItem
              key={item._id}
              item={item}
              blockId={blockId}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
};

/* -------------------------------------------------------------------------------------------------
 * LinkFieldEditor
 * -----------------------------------------------------------------------------------------------*/

interface LinkFieldEditorProps {
  fieldName: string;
  label: string;
  linkValue: { text: string; href: string; newTab: boolean };
  blockId: Id<"blocks">;
}

const LinkFieldEditor = ({
  fieldName,
  label,
  linkValue,
  blockId,
}: LinkFieldEditorProps) => {
  const updateBlockContent = useMutation(api.blocks.updateBlockContent);
  const timerRef = React.useRef<number | null>(null);
  const [text, setText] = React.useState(linkValue.text);
  const [href, setHref] = React.useState(linkValue.href);
  const linkValueRef = React.useRef(linkValue);

  React.useEffect(() => {
    linkValueRef.current = linkValue;
  }, [linkValue]);

  React.useEffect(() => {
    setText(linkValue.text);
  }, [linkValue.text]);

  React.useEffect(() => {
    setHref(linkValue.href);
  }, [linkValue.href]);

  React.useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleChange = (subField: string, value: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      updateBlockContent({
        blockId,
        content: { [fieldName]: { ...linkValueRef.current, [subField]: value } },
      });
    }, 500);
  };

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label
            htmlFor={`${fieldName}-text`}
            className="text-xs text-muted-foreground"
          >
            Text
          </Label>
          <Input
            id={`${fieldName}-text`}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              handleChange("text", e.target.value);
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label
            htmlFor={`${fieldName}-href`}
            className="text-xs text-muted-foreground"
          >
            URL
          </Label>
          <Input
            id={`${fieldName}-href`}
            type="url"
            value={href}
            onChange={(e) => {
              setHref(e.target.value);
              handleChange("href", e.target.value);
            }}
          />
        </div>
        <div className="flex items-center gap-2">
          <Switch
            id={`${fieldName}-newtab`}
            checked={linkValue.newTab}
            onCheckedChange={(checked) => {
              updateBlockContent({
                blockId,
                content: {
                  [fieldName]: { ...linkValueRef.current, newTab: checked },
                },
              });
            }}
          />
          <Label htmlFor={`${fieldName}-newtab`}>Open in new tab</Label>
        </div>
      </div>
    </div>
  );
};

/* -------------------------------------------------------------------------------------------------
 * PageContentSheet
 * -----------------------------------------------------------------------------------------------*/

const PageContentSheet = () => {
  const camoxApp = useCamoxApp();
  const updateBlockContent = useMutation(api.blocks.updateBlockContent);
  const updateBlockSettings = useMutation(api.blocks.updateBlockSettings);
  const timerRef = React.useRef<number | null>(null);

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

  // Find the deepest Block in breadcrumbs
  const blockBreadcrumb = [...selectionBreadcrumbs]
    .reverse()
    .find((b) => b.type === "Block");
  const blockId = blockBreadcrumb?.id as Id<"blocks"> | undefined;

  // Look up the actual block document from page data
  const page = usePreviewedPage();
  const block = blockId ? page?.blocks.find((b) => b._id === blockId) : null;

  // Get block definition and all fields in schema order
  const blockDef = block ? camoxApp.getBlockById(block.type) : null;
  const schemaFields = React.useMemo(() => {
    return blockDef ? getSchemaFieldsInOrder(blockDef.contentSchema) : [];
  }, [blockDef]);

  const settingsFields = React.useMemo(() => {
    return blockDef ? getSettingsFields(blockDef.settingsSchema) : [];
  }, [blockDef]);

  // Get only scalar fields for form (Link is handled separately as it's an object)
  const scalarFields = React.useMemo(() => {
    return schemaFields
      .filter((f) => f.fieldType === "String" || f.fieldType === "Embed")
      .map((f) => f.name);
  }, [schemaFields]);

  // Build default values from block content (only scalar fields)
  const defaultValues = React.useMemo(() => {
    const values: Record<string, string> = {};
    if (!block) return values;
    for (const fieldName of scalarFields) {
      values[fieldName] = (block.content[fieldName] as string) ?? "";
    }
    return values;
  }, [block, scalarFields]);

  const form = useForm({
    defaultValues,
  });

  // Reset form when block changes
  React.useEffect(() => {
    if (isOpen && block?._id) {
      form.update({ defaultValues });
    }
  }, [isOpen, block?._id, defaultValues, form]);

  // Get selected field from breadcrumbs (if any)
  const selectedFieldName =
    selectionBreadcrumbs.length === 2 &&
    selectionBreadcrumbs[1]?.type !== "Block"
      ? selectionBreadcrumbs[1]?.id
      : null;

  // Auto-focus selected field when sheet opens (called from onOpenAutoFocus)
  const handleOpenAutoFocus = React.useCallback(
    (e: Event) => {
      e.preventDefault();
      if (!selectedFieldName) return;
      // Small delay to ensure the sheet is fully rendered
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

  // Cleanup timer on unmount
  React.useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

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

  const handleFieldChange = (
    fieldName: string,
    value: string,
    fieldApi: any,
  ) => {
    if (!block) return;
    fieldApi.handleChange(value);

    // Clear existing timer
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    // Debounced save
    timerRef.current = window.setTimeout(() => {
      updateBlockContent({
        blockId: block._id,
        content: { [fieldName]: value },
      });
    }, 500);
  };

  const handleOpenChange = (open: boolean) => {
    if (open) return;
    if (block && selectedFieldName) {
      postToIframe({
        type: "CAMOX_FOCUS_FIELD_END",
        fieldId: `${block._id}__${selectedFieldName}`,
      });
    }
    previewStore.send({ type: "closeBlockContentSheet" });
  };

  const handleFieldFocus = (fieldName: string, fieldType: string) => {
    if (!block) return;
    previewStore.send({
      type: "setSelectedField",
      blockId: block._id,
      fieldName,
      fieldType: fieldType as "String" | "RepeatableObject",
    });
    postToIframe({
      type: "CAMOX_FOCUS_FIELD",
      fieldId: `${block._id}__${fieldName}`,
    });
  };

  const handleFieldBlur = (fieldName: string) => {
    if (!block) return;
    previewStore.send({
      type: "setFocusedBlock",
      blockId: block._id,
    });
    postToIframe({
      type: "CAMOX_FOCUS_FIELD_END",
      fieldId: `${block._id}__${fieldName}`,
    });
  };

  if (
    !block ||
    !blockDef ||
    (schemaFields.length === 0 && settingsFields.length === 0)
  ) {
    return null;
  }

  return (
    <PreviewSideSheet
      open={isOpen}
      onOpenChange={handleOpenChange}
      onOpenAutoFocus={handleOpenAutoFocus}
      className="flex flex-col"
    >
      <SheetParts.SheetHeader className="border-b border-border">
        <SheetParts.SheetTitle>Edit {blockDef.title}</SheetParts.SheetTitle>
        <SheetParts.SheetDescription>
          Changes are saved automatically.
        </SheetParts.SheetDescription>
      </SheetParts.SheetHeader>
        <div className="flex-1 overflow-auto">
          <form className="space-y-4 py-4 px-4">
            {schemaFields.map((field) => {
              const label = field.label ?? formatFieldName(field.name);

              if (field.fieldType === "String") {
                return (
                  <form.Field key={field.name} name={field.name}>
                    {(fieldApi) => (
                      <div
                        className="space-y-2"
                        onMouseEnter={() =>
                          postToIframe({
                            type: "CAMOX_HOVER_FIELD",
                            fieldId: `${block._id}__${field.name}`,
                          })
                        }
                        onMouseLeave={() =>
                          postToIframe({
                            type: "CAMOX_HOVER_FIELD_END",
                            fieldId: `${block._id}__${field.name}`,
                          })
                        }
                      >
                        <Label htmlFor={field.name}>{label}</Label>
                        <Textarea
                          id={field.name}
                          value={fieldApi.state.value}
                          onChange={(e) =>
                            handleFieldChange(
                              field.name,
                              e.target.value,
                              fieldApi,
                            )
                          }
                          onFocus={() =>
                            handleFieldFocus(field.name, field.fieldType)
                          }
                          onBlur={() => handleFieldBlur(field.name)}
                          rows={4}
                        />
                      </div>
                    )}
                  </form.Field>
                );
              }

              if (field.fieldType === "Embed") {
                return (
                  <form.Field key={field.name} name={field.name}>
                    {(fieldApi) => (
                      <div
                        className="space-y-2"
                        onMouseEnter={() =>
                          postToIframe({
                            type: "CAMOX_HOVER_FIELD",
                            fieldId: `${block._id}__${field.name}`,
                          })
                        }
                        onMouseLeave={() =>
                          postToIframe({
                            type: "CAMOX_HOVER_FIELD_END",
                            fieldId: `${block._id}__${field.name}`,
                          })
                        }
                      >
                        <Label htmlFor={field.name}>{label}</Label>
                        <Input
                          id={field.name}
                          type="url"
                          value={fieldApi.state.value}
                          onChange={(e) =>
                            handleFieldChange(
                              field.name,
                              e.target.value,
                              fieldApi,
                            )
                          }
                          onFocus={() =>
                            handleFieldFocus(field.name, field.fieldType)
                          }
                          onBlur={() => handleFieldBlur(field.name)}
                        />
                      </div>
                    )}
                  </form.Field>
                );
              }

              if (field.fieldType === "Link") {
                const linkValue = block.content[field.name] as
                  | { text: string; href: string; newTab: boolean }
                  | undefined;
                if (!linkValue) return null;

                return (
                  <LinkFieldEditor
                    key={field.name}
                    fieldName={field.name}
                    label={label}
                    linkValue={linkValue}
                    blockId={block._id}
                  />
                );
              }

              if (field.fieldType === "RepeatableObject") {
                const items = block.content[field.name] as
                  | Doc<"repeatableItems">[]
                  | undefined;
                if (!items || items.length === 0) return null;

                return (
                  <div key={field.name} className="space-y-2">
                    <Label>{label}</Label>
                    <RepeatableItemsList items={items} blockId={block._id} />
                  </div>
                );
              }

              return null;
            })}
          </form>
          {settingsFields.length > 0 && (
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
