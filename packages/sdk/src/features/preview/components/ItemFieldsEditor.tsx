import { Input } from "@camox/ui/input";
import { Label } from "@camox/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@camox/ui/select";
import { Switch } from "@camox/ui/switch";
import { useForm } from "@tanstack/react-form";
import {
  Link2 as Link2Icon,
  Images as ImagesIcon,
  ImageIcon,
  FileIcon,
  Type,
  List,
  Code,
  ToggleLeft,
  ListFilter,
} from "lucide-react";
import * as React from "react";

import { SidebarLexicalEditor } from "@/core/components/lexical/SidebarLexicalEditor";
import type { FieldType } from "@/core/lib/fieldTypes";
import { lexicalStateToPlainText } from "@/core/lib/lexicalState";
import {
  isFileMarker,
  isItemMarker,
  resolveFileMarker,
  type NormalizedFile,
  type NormalizedItem,
} from "@/lib/normalized-data";

import type { OverlayMessage } from "../overlayMessages";
import { previewStore } from "../previewStore";
import { IconFieldEditor } from "./IconFieldEditor";
import { RepeatableItemsList } from "./RepeatableItemsList";

/* -------------------------------------------------------------------------------------------------
 * SchemaField type + helpers (shared)
 * -----------------------------------------------------------------------------------------------*/

export interface SchemaField {
  name: string;
  fieldType: FieldType;
  label?: string;
  enumLabels?: Record<string, string>;
  enumValues?: string[];
  minItems?: number;
  maxItems?: number;
}

export const formatFieldName = (fieldName: string): string => {
  // Convert camelCase to Title Case with spaces
  return fieldName
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (str) => str.toUpperCase())
    .trim();
};

const getSchemaFieldsInOrder = (schema: unknown): SchemaField[] => {
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
      minItems: prop.minItems as number | undefined,
      maxItems: prop.maxItems as number | undefined,
    };
  });
};

/* -------------------------------------------------------------------------------------------------
 * DrillRow — label + click-to-drill button shared by Link / Image / File / ImageList / FileList
 * -----------------------------------------------------------------------------------------------*/

type DrillRowHover =
  | { variant: "field"; fieldId: string }
  | { variant: "repeater"; blockId: number; fieldName: string };

interface DrillRowProps {
  label: string;
  preview: string;
  Icon: React.ComponentType<{ className?: string }>;
  onClick: () => void;
  hover: DrillRowHover;
  postToIframe: (message: OverlayMessage) => void;
}

const DrillRow = ({ label, preview, Icon, onClick, hover, postToIframe }: DrillRowProps) => {
  const handleMouseEnter = () => {
    if (hover.variant === "field") {
      postToIframe({ type: "CAMOX_HOVER_FIELD", fieldId: hover.fieldId });
      return;
    }
    postToIframe({
      type: "CAMOX_HOVER_REPEATER",
      blockId: String(hover.blockId),
      fieldName: hover.fieldName,
    });
  };

  const handleMouseLeave = () => {
    if (hover.variant === "field") {
      postToIframe({ type: "CAMOX_HOVER_FIELD_END", fieldId: hover.fieldId });
      return;
    }
    postToIframe({
      type: "CAMOX_HOVER_REPEATER_END",
      blockId: String(hover.blockId),
      fieldName: hover.fieldName,
    });
  };

  return (
    <div className="space-y-2" onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
      <Label>{label}</Label>
      <button
        type="button"
        className="hover:bg-accent/75 flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition-colors"
        onClick={onClick}
      >
        <Icon className="text-muted-foreground h-4 w-4 shrink-0" />
        <span className="truncate">{preview}</span>
      </button>
    </div>
  );
};

/* -------------------------------------------------------------------------------------------------
 * ItemFieldsEditor — reusable field renderer for any depth
 * -----------------------------------------------------------------------------------------------*/

interface ItemFieldsEditorProps {
  selectedFieldName?: string;
  schema: unknown;
  data: Record<string, unknown>;
  blockId: number;
  /** When editing a repeatable item's fields, pass its ID for correct overlay targeting */
  itemId?: number;
  onFieldChange: (fieldName: string, value: unknown) => void;
  postToIframe: (message: OverlayMessage) => void;
  /** Lookup maps for resolving _fileId and _itemId markers */
  filesMap: Map<number, NormalizedFile>;
  itemsMap: Map<number, NormalizedItem>;
  /** Prefix used to scope DOM ids for each field so label-input pairs and
   * imperative focus lookups don't collide across sheet instances. */
  fieldIdPrefix: string;
}

const ItemFieldsEditor = ({
  selectedFieldName,
  schema,
  data,
  blockId,
  itemId,
  onFieldChange,
  postToIframe,
  filesMap,
  itemsMap,
  fieldIdPrefix,
}: ItemFieldsEditorProps) => {
  const fields = React.useMemo(
    () =>
      getSchemaFieldsInOrder(schema).filter(
        (field) => !selectedFieldName || field.name === selectedFieldName,
      ),
    [schema, selectedFieldName],
  );
  const pendingSaveRef = React.useRef<(() => void) | null>(null);
  const timerRef = React.useRef<number | null>(null);
  const focusedFieldIdRef = React.useRef<string | null>(null);

  // Build field ID matching the iframe's getOverlayFieldId format
  const getFieldId = (fieldName: string) => {
    if (itemId != null) return `${blockId}__${itemId}__${fieldName}`;
    return `${blockId}__${fieldName}`;
  };

  const getFieldElementId = (fieldName: string) => `${fieldIdPrefix}-${fieldName}`;

  const scalarFields = React.useMemo(() => {
    return fields
      .filter((f) => f.fieldType === "String" || f.fieldType === "Embed")
      .map((f) => f.name);
  }, [fields]);

  const defaultValues = React.useMemo(() => {
    const values: Record<string, unknown> = {};
    for (const fieldName of scalarFields) {
      values[fieldName] = data[fieldName] ?? "";
    }
    return values;
  }, [data, scalarFields]);

  const form = useForm({ defaultValues });

  React.useEffect(() => {
    form.update({ defaultValues });
  }, [defaultValues, form]);

  // Clear any focused field overlay on unmount (e.g. when sheet closes)
  React.useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      pendingSaveRef.current?.();
      pendingSaveRef.current = null;
      if (focusedFieldIdRef.current) {
        postToIframe({
          type: "CAMOX_FOCUS_FIELD_END",
          fieldId: focusedFieldIdRef.current,
        });
      }
    };
  }, [postToIframe]);

  const handleScalarChange = (fieldName: string, value: unknown, fieldApi: any) => {
    fieldApi.handleChange(value);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    pendingSaveRef.current = () => onFieldChange(fieldName, value);
    timerRef.current = window.setTimeout(() => {
      pendingSaveRef.current?.();
      pendingSaveRef.current = null;
      timerRef.current = null;
    }, 500);
  };

  const handleFieldFocus = (fieldName: string, fieldType: FieldType) => {
    const fieldId = getFieldId(fieldName);
    focusedFieldIdRef.current = fieldId;
    postToIframe({ type: "CAMOX_FOCUS_FIELD", fieldId });
    if (itemId != null) {
      previewStore.send({ type: "selectItemField", blockId, itemId, fieldName, fieldType });
    } else {
      previewStore.send({ type: "selectBlockField", blockId, fieldName, fieldType });
    }
  };

  const handleFieldBlur = (fieldName: string) => {
    const fieldId = getFieldId(fieldName);
    focusedFieldIdRef.current = null;
    postToIframe({ type: "CAMOX_FOCUS_FIELD_END", fieldId });
    // Keep the field screen open when focus moves into its comments.
  };

  /** Dispatch the correct drill-into event depending on whether we're at block or item level. */
  const drillIntoField = (fieldName: string, fieldType: FieldType) => {
    if (itemId != null) {
      previewStore.send({
        type: "selectItemField",
        blockId,
        itemId,
        fieldName,
        fieldType,
      });
    } else {
      previewStore.send({
        type: "selectBlockField",
        blockId,
        fieldName,
        fieldType,
      });
    }
  };

  return (
    <form className="space-y-4 px-2 py-4">
      {fields.map((field) => {
        const label = field.label ?? formatFieldName(field.name);
        const fieldId = getFieldId(field.name);

        const renderField = () => {
          if (
            !selectedFieldName &&
            ["String", "Embed", "Repeater", "Enum", "Boolean", "Icon"].includes(field.fieldType)
          ) {
            const value = data[field.name];
            const preview =
              field.fieldType === "String"
                ? lexicalStateToPlainText((value ?? "") as string | Record<string, unknown>) ||
                  "Empty text"
                : field.fieldType === "Repeater"
                  ? `${Array.isArray(value) ? value.length : 0} items`
                  : field.fieldType === "Boolean"
                    ? value
                      ? "On"
                      : "Off"
                    : typeof value === "string" && value
                      ? value
                      : "Empty";
            return (
              <DrillRow
                key={field.name}
                label={label}
                preview={preview}
                Icon={
                  field.fieldType === "String"
                    ? Type
                    : field.fieldType === "Repeater"
                      ? List
                      : field.fieldType === "Embed"
                        ? Code
                        : field.fieldType === "Boolean"
                          ? ToggleLeft
                          : ListFilter
                }
                onClick={() => drillIntoField(field.name, field.fieldType)}
                hover={
                  field.fieldType === "Repeater"
                    ? { variant: "repeater", blockId, fieldName: field.name }
                    : { variant: "field", fieldId }
                }
                postToIframe={postToIframe}
              />
            );
          }
          if (field.fieldType === "Icon") {
            return (
              <IconFieldEditor
                key={field.name}
                value={String(
                  data[field.name] ?? (schema as any)?.properties?.[field.name]?.default ?? "",
                )}
                ids={field.enumValues ?? []}
                onChange={(value) => onFieldChange(field.name, value)}
              />
            );
          }
          if (field.fieldType === "Boolean") {
            return (
              <div key={field.name} className="flex items-center justify-between">
                <Label htmlFor={getFieldElementId(field.name)}>{label}</Label>
                <Switch
                  id={getFieldElementId(field.name)}
                  checked={Boolean(data[field.name])}
                  onCheckedChange={(value) => onFieldChange(field.name, value)}
                />
              </div>
            );
          }
          if (field.fieldType === "Enum") {
            return (
              <div key={field.name} className="space-y-2">
                <Label htmlFor={getFieldElementId(field.name)}>{label}</Label>
                <Select
                  value={typeof data[field.name] === "string" ? (data[field.name] as string) : ""}
                  onValueChange={(value) => onFieldChange(field.name, value)}
                >
                  <SelectTrigger id={getFieldElementId(field.name)}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {field.enumValues?.map((value) => (
                      <SelectItem key={value} value={value}>
                        {field.enumLabels?.[value] ?? value}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            );
          }
          if (field.fieldType === "String") {
            return (
              <form.Field key={field.name} name={field.name}>
                {(fieldApi) => (
                  <div
                    className="space-y-2"
                    onMouseEnter={() =>
                      postToIframe({
                        type: "CAMOX_HOVER_FIELD",
                        fieldId,
                      })
                    }
                    onMouseLeave={() =>
                      postToIframe({
                        type: "CAMOX_HOVER_FIELD_END",
                        fieldId,
                      })
                    }
                  >
                    <Label htmlFor={getFieldElementId(field.name)}>{label}</Label>
                    <SidebarLexicalEditor
                      id={getFieldElementId(field.name)}
                      value={fieldApi.state.value as string | Record<string, unknown>}
                      onChange={(value) => handleScalarChange(field.name, value, fieldApi)}
                      onFocus={() => handleFieldFocus(field.name, field.fieldType)}
                      onBlur={() => handleFieldBlur(field.name)}
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
                        fieldId,
                      })
                    }
                    onMouseLeave={() =>
                      postToIframe({
                        type: "CAMOX_HOVER_FIELD_END",
                        fieldId,
                      })
                    }
                  >
                    <Label htmlFor={getFieldElementId(field.name)}>{label}</Label>
                    <Input
                      id={getFieldElementId(field.name)}
                      type="url"
                      value={fieldApi.state.value as string}
                      onChange={(e) => handleScalarChange(field.name, e.target.value, fieldApi)}
                      onFocus={() => handleFieldFocus(field.name, field.fieldType)}
                      onBlur={() => handleFieldBlur(field.name)}
                    />
                  </div>
                )}
              </form.Field>
            );
          }

          if (field.fieldType === "Link") {
            const linkValue = data[field.name] as
              | { text: string; href: string; newTab: boolean }
              | undefined;
            const preview = linkValue?.text || linkValue?.href || "Empty link";

            return (
              <DrillRow
                key={field.name}
                label={label}
                preview={preview}
                Icon={Link2Icon}
                onClick={() => drillIntoField(field.name, "Link")}
                hover={{ variant: "field", fieldId }}
                postToIframe={postToIframe}
              />
            );
          }

          if (field.fieldType === "ImageList" || field.fieldType === "FileList") {
            // The side editor always reflects real persisted data — `defaultItems`
            // is a peek-only render affordance and never a real count.
            const value = data[field.name];
            const count = Array.isArray(value) ? value.length : 0;
            const isImage = field.fieldType === "ImageList";
            const noun = isImage ? "image" : "file";
            let preview: string;
            if (count === 0) {
              preview = isImage ? "No images" : "No files";
            } else if (count === 1) {
              preview = `1 ${noun}`;
            } else {
              preview = `${count} ${noun}s`;
            }

            return (
              <DrillRow
                key={field.name}
                label={label}
                preview={preview}
                Icon={isImage ? ImagesIcon : FileIcon}
                onClick={() => drillIntoField(field.name, isImage ? "Image" : "File")}
                hover={{ variant: "repeater", blockId, fieldName: field.name }}
                postToIframe={postToIframe}
              />
            );
          }

          if (field.fieldType === "Image") {
            const rawImage = data[field.name];
            const imageValue = isFileMarker(rawImage)
              ? resolveFileMarker(rawImage, filesMap)
              : (rawImage as { filename?: string } | undefined);
            const preview = imageValue?.filename || "No image";

            return (
              <DrillRow
                key={field.name}
                label={label}
                preview={preview}
                Icon={ImageIcon}
                onClick={() => drillIntoField(field.name, "Image")}
                hover={{ variant: "field", fieldId }}
                postToIframe={postToIframe}
              />
            );
          }

          if (field.fieldType === "File") {
            const rawFile = data[field.name];
            const fileValue = isFileMarker(rawFile)
              ? resolveFileMarker(rawFile, filesMap)
              : (rawFile as { filename?: string } | undefined);
            const preview = fileValue?.filename || "No file";

            return (
              <DrillRow
                key={field.name}
                label={label}
                preview={preview}
                Icon={FileIcon}
                onClick={() => drillIntoField(field.name, "File")}
                hover={{ variant: "field", fieldId }}
                postToIframe={postToIframe}
              />
            );
          }

          if (field.fieldType === "Repeater") {
            const rawItems = (data[field.name] ?? []) as any[];
            // Resolve _itemId markers to full item objects
            const items = rawItems
              .map((item: any) => {
                if (isItemMarker(item)) {
                  return itemsMap.get(item._itemId) ?? null;
                }
                return item;
              })
              .filter(Boolean) as Array<{
              id: number;
              summary: string;
              position: string;
              content: Record<string, unknown>;
            }>;
            const fieldSchema = (schema as any)?.properties?.[field.name];

            return (
              <div key={field.name} className="space-y-2">
                <Label>{label}</Label>
                <RepeatableItemsList
                  items={items}
                  blockId={blockId}
                  fieldName={field.name}
                  schema={fieldSchema}
                />
              </div>
            );
          }

          return null;
        };

        return renderField();
      })}
    </form>
  );
};

export { ItemFieldsEditor };
