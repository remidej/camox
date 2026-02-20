import * as React from "react";
import { useForm } from "@tanstack/react-form";

import { Link2 as Link2Icon } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Doc, Id } from "camox/_generated/dataModel";
import type { OverlayMessage } from "../overlayMessages";
import { previewStore } from "../previewStore";
import { RepeatableItemsList } from "./RepeatableItemsList";

/* -------------------------------------------------------------------------------------------------
 * SchemaField type + helpers (shared)
 * -----------------------------------------------------------------------------------------------*/

export interface SchemaField {
  name: string;
  fieldType:
    | "String"
    | "RepeatableObject"
    | "Enum"
    | "Boolean"
    | "Embed"
    | "Link";
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
      minItems: prop.minItems as number | undefined,
      maxItems: prop.maxItems as number | undefined,
    };
  });
};

/* -------------------------------------------------------------------------------------------------
 * ItemFieldsEditor — reusable field renderer for any depth
 * -----------------------------------------------------------------------------------------------*/

interface ItemFieldsEditorProps {
  schema: unknown;
  data: Record<string, unknown>;
  blockId: Id<"blocks">;
  /** When editing a repeatable item's fields, pass its ID for correct overlay targeting */
  itemId?: Id<"repeatableItems">;
  onFieldChange: (fieldName: string, value: unknown) => void;
  postToIframe: (message: OverlayMessage) => void;
}

const ItemFieldsEditor = ({
  schema,
  data,
  blockId,
  itemId,
  onFieldChange,
  postToIframe,
}: ItemFieldsEditorProps) => {
  const fields = React.useMemo(() => getSchemaFieldsInOrder(schema), [schema]);
  const timerRef = React.useRef<number | null>(null);
  const focusedFieldIdRef = React.useRef<string | null>(null);

  // Build field ID with the correct pattern: blockId__fieldName or blockId__itemId__fieldName
  const getFieldId = (fieldName: string) =>
    itemId ? `${blockId}__${itemId}__${fieldName}` : `${blockId}__${fieldName}`;

  const scalarFields = React.useMemo(() => {
    return fields
      .filter((f) => f.fieldType === "String" || f.fieldType === "Embed")
      .map((f) => f.name);
  }, [fields]);

  const defaultValues = React.useMemo(() => {
    const values: Record<string, string> = {};
    for (const fieldName of scalarFields) {
      values[fieldName] = (data[fieldName] as string) ?? "";
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
      if (focusedFieldIdRef.current) {
        postToIframe({
          type: "CAMOX_FOCUS_FIELD_END",
          fieldId: focusedFieldIdRef.current,
        });
      }
    };
  }, [postToIframe]);

  const handleScalarChange = (
    fieldName: string,
    value: string,
    fieldApi: any,
  ) => {
    fieldApi.handleChange(value);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      onFieldChange(fieldName, value);
    }, 500);
  };

  const handleFieldFocus = (fieldName: string) => {
    const fieldId = getFieldId(fieldName);
    focusedFieldIdRef.current = fieldId;
    postToIframe({ type: "CAMOX_FOCUS_FIELD", fieldId });
  };

  const handleFieldBlur = (fieldName: string) => {
    const fieldId = getFieldId(fieldName);
    focusedFieldIdRef.current = null;
    postToIframe({ type: "CAMOX_FOCUS_FIELD_END", fieldId });
  };

  return (
    <form className="space-y-4 py-4 px-4">
      {fields.map((field) => {
        const label = field.label ?? formatFieldName(field.name);
        const fieldId = getFieldId(field.name);

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
                  <Label htmlFor={field.name}>{label}</Label>
                  <Textarea
                    id={field.name}
                    value={fieldApi.state.value}
                    onChange={(e) =>
                      handleScalarChange(field.name, e.target.value, fieldApi)
                    }
                    onFocus={() => handleFieldFocus(field.name)}
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
                  <Label htmlFor={field.name}>{label}</Label>
                  <Input
                    id={field.name}
                    type="url"
                    value={fieldApi.state.value}
                    onChange={(e) =>
                      handleScalarChange(field.name, e.target.value, fieldApi)
                    }
                    onFocus={() => handleFieldFocus(field.name)}
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
            <div key={field.name} className="space-y-2">
              <Label>{label}</Label>
              <button
                type="button"
                className="flex items-center gap-2 w-full rounded-lg px-2 py-2 text-sm text-left hover:bg-accent/75 transition-colors"
                onClick={() =>
                  previewStore.send({
                    type: "drillIntoLink",
                    fieldName: field.name,
                  })
                }
              >
                <Link2Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{preview}</span>
              </button>
            </div>
          );
        }

        if (field.fieldType === "RepeatableObject") {
          const items = data[field.name] as
            | Doc<"repeatableItems">[]
            | undefined;
          const fieldSchema = (schema as any)?.properties?.[field.name];

          return (
            <div key={field.name} className="space-y-2">
              <Label>{label}</Label>
              <RepeatableItemsList
                items={items ?? []}
                blockId={blockId}
                fieldName={field.name}
                minItems={field.minItems}
                maxItems={field.maxItems}
                schema={fieldSchema}
              />
            </div>
          );
        }

        return null;
      })}
    </form>
  );
};

export { ItemFieldsEditor };
