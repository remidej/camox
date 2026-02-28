import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { useSelector } from "@xstate/store/react";
import { useMutation, useQuery } from "convex/react";
import {
  Type as TypeBoxType,
  type TSchema,
  type Static,
} from "@sinclair/typebox";
import { api } from "camox/_generated/api";
import { previewStore } from "../features/preview/previewStore";
import { postOverlayMessage } from "../features/preview/overlayMessages";
import {
  OVERLAY_WIDTHS,
  OVERLAY_OFFSETS,
  OVERLAY_COLORS,
} from "../features/preview/overlayConstants";
import { useFrame } from "../components/ui/frame";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverAnchor,
} from "../components/ui/popover";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { toast } from "../components/ui/toaster";
import { Kbd } from "../components/ui/kbd";
import type { Id } from "camox/_generated/dataModel";
import { useIsEditable } from "./hooks/useIsEditable.ts";
import { useOverlayMessage } from "./hooks/useOverlayMessage.ts";
import { AddBlockControlBar } from "./components/AddBlockControlBar.tsx";
import { useIsPreviewSheetOpen } from "@/features/preview/components/PreviewSideSheet.tsx";
import {
  Type,
  type EmbedURL,
  type LinkValue,
  type ImageValue,
  type FileValue,
} from "./lib/contentType.ts";

export { Type };

/** Normalize legacy links (no `type` field) to the new union shape */
const normalizeLinkValue = (value: Record<string, unknown>): LinkValue => {
  if (!value.type) {
    return { type: "external", ...value } as LinkValue;
  }
  return value as LinkValue;
};

/** Resolve a LinkValue to an href string */
const resolveLinkHref = (
  link: LinkValue,
  pages: Array<{ _id: string; fullPath: string }> | undefined,
): string => {
  if (link.type === "page") {
    const page = pages?.find((p) => p._id === link.pageId);
    return page?.fullPath ?? "#";
  }
  return link.href;
};

let hasShownEmbedLockToast = false;

/* -------------------------------------------------------------------------------------------------
 * createBlock
 * -----------------------------------------------------------------------------------------------*/

interface CreateBlockOptions<
  TSchemaShape extends Record<string, TSchema> = Record<string, TSchema>,
  TSettingsShape extends Record<string, TSchema> = Record<string, TSchema>,
> {
  id: string;
  /**
   * Human-readable title for the block (JSON Schema `title`).
   */
  title: string;
  /**
   * Description for AI agents on when and how to use this block (JSON Schema `description`).
   * This should describe the block's purpose, typical use cases, and any important
   * considerations for placement or configuration.
   */
  description: string;
  /**
   * Schema defining the structure of the block's editable content.
   * All fields must have default values.
   * Use Type.String() and Type.RepeatableObject() to define the schema.
   *
   * @example
   * content: {
   *   title: Type.String({ default: 'Hello' }),
   *   items: Type.RepeatableObject({
   *     name: Type.String({ default: 'Item' })
   *   }, { minItems: 1, maxItems: 10 })
   * }
   */
  content: TSchemaShape;
  /**
   * Optional schema defining block-level settings (e.g. layout variant, toggles).
   * Settings are not inline-editable; they use Type.Enum() and Type.Boolean().
   *
   * @example
   * settings: {
   *   alignment: Type.Enum({ default: 'left', options: { left: 'Left', center: 'Center' } }),
   *   showBackground: Type.Boolean({ default: true })
   * }
   */
  settings?: TSettingsShape;
  /**
   * React component that renders the block.
   * Must be defined as a separate function (not inline, not an arrow function).
   * Should use the Field component returned by createBlock to render editable content.
   */
  component: React.ComponentType<{
    content: Static<ReturnType<typeof TypeBoxType.Object<TSchemaShape>>>;
  }>;
}

interface BlockData<TContent> {
  _id: Id<"blocks">;
  type: string;
  content: TContent;
  settings?: Record<string, unknown>;
  position: string;
}

export interface BlockComponentProps<TContent> {
  blockData: BlockData<TContent>;
  mode: "site" | "peek";
  isFirstBlock?: boolean;
}

export function createBlock<
  TSchemaShape extends Record<string, TSchema>,
  TSettingsShape extends Record<string, TSchema> = Record<string, never>,
>(options: CreateBlockOptions<TSchemaShape, TSettingsShape>) {
  // Build TypeBox schema for runtime validation and default value creation
  const typeboxSchema = TypeBoxType.Object(options.content);

  // Build a richer JSON Schema object
  const contentSchema = {
    type: "object" as const,
    title: options.title,
    description: options.description,
    properties: typeboxSchema.properties,
    required: Object.keys(options.content),
  };

  // Build settings schema (if provided)
  const settingsTypeboxSchema = options.settings
    ? TypeBoxType.Object(options.settings)
    : null;

  const settingsSchema = settingsTypeboxSchema
    ? {
        type: "object" as const,
        properties: settingsTypeboxSchema.properties,
        required: Object.keys(options.settings!),
      }
    : undefined;

  // Extract defaults manually since Value.Create doesn't support Unsafe types (used by Type.Enum and Type.Embed)
  const contentDefaults: Record<string, unknown> = {};
  for (const [key, prop] of Object.entries(typeboxSchema.properties)) {
    if ("default" in prop) {
      contentDefaults[key] = prop.default;
    }
  }

  const settingsDefaults: Record<string, unknown> = {};
  if (settingsTypeboxSchema) {
    for (const [key, prop] of Object.entries(
      settingsTypeboxSchema.properties,
    )) {
      if ("default" in prop) {
        settingsDefaults[key] = prop.default;
      }
    }
  }

  type TContent = Static<typeof typeboxSchema>;
  type TSettings =
    TSettingsShape extends Record<string, never>
      ? Record<string, never>
      : Static<ReturnType<typeof TypeBoxType.Object<TSettingsShape>>>;

  type BlockContextValue = {
    blockId: Id<"blocks">;
    content: TContent;
    settings: TSettings;
  } & Pick<BlockComponentProps<TContent>, "mode">;

  interface RepeaterItemContextValue {
    arrayFieldName: string;
    itemIndex: number;
    itemContent: any;
    itemId?: Id<"repeatableItems">;
    nested?: {
      parentItemId: Id<"repeatableItems">;
      parentContent: any;
      parentArrayFieldName: string;
      nestedFieldName: string;
      nestedIndex: number;
    };
  }

  const Context = React.createContext<BlockContextValue | null>(null);
  const RepeaterItemContext =
    React.createContext<RepeaterItemContextValue | null>(null);

  // Context to track if the parent repeater container is being hovered from sidebar
  const RepeaterHoverContext = React.createContext<boolean>(false);

  /**
   * Build a field ID that matches the sidebar's `getFieldId` format.
   * Root fields:          blockId__fieldName
   * Repeater item fields: blockId__itemId__fieldName
   * Nested item fields:   blockId__parentItemId:nestedFieldName:index__fieldName
   */
  const getOverlayFieldId = (
    blockId: Id<"blocks">,
    repeaterContext: RepeaterItemContextValue | null,
    fieldName: string,
  ): string => {
    if (repeaterContext?.itemId) {
      return `${blockId}__${repeaterContext.itemId}__${fieldName}`;
    }
    if (repeaterContext?.nested) {
      const { parentItemId, nestedFieldName, nestedIndex } =
        repeaterContext.nested;
      return `${blockId}__${parentItemId}:${nestedFieldName}:${nestedIndex}__${fieldName}`;
    }
    return `${blockId}__${fieldName}`;
  };

  // Only allow string fields - not objects, arrays, or embed URLs
  type StringFields = {
    [K in keyof TContent as TContent[K] extends EmbedURL
      ? never
      : TContent[K] extends string
        ? K
        : never]: TContent[K];
  };

  // Only allow embed URL fields
  type EmbedFields = {
    [K in keyof TContent as TContent[K] extends EmbedURL
      ? K
      : never]: TContent[K];
  };

  // Only allow link fields
  type LinkFields = {
    [K in keyof TContent as TContent[K] extends LinkValue
      ? K
      : never]: TContent[K];
  };

  // Only allow image fields
  type ImageFields = {
    [K in keyof TContent as ImageValue extends TContent[K]
      ? TContent[K] extends ImageValue
        ? K
        : never
      : never]: TContent[K];
  };

  // Only allow file fields
  type FileFields = {
    [K in keyof TContent as FileValue extends TContent[K]
      ? TContent[K] extends FileValue
        ? K
        : never
      : never]: TContent[K];
  };

  // Only allow array fields (from repeatableObject)
  type RepeatableFields = {
    [K in keyof TContent as TContent[K] extends Array<any>
      ? K
      : never]: TContent[K];
  };

  // Extract the element type from a repeatable array field
  type RepeatableItemType<K extends keyof RepeatableFields> =
    RepeatableFields[K] extends Array<infer U> ? U : never;

  // Extract string fields from a repeatable item type
  type ItemStringFields<K extends keyof RepeatableFields> = {
    [F in keyof RepeatableItemType<K> as RepeatableItemType<K>[F] extends string
      ? F
      : never]: RepeatableItemType<K>[F];
  };

  // Extract link fields from a repeatable item type
  type ItemLinkFields<K extends keyof RepeatableFields> = {
    [F in keyof RepeatableItemType<K> as RepeatableItemType<K>[F] extends LinkValue
      ? F
      : never]: RepeatableItemType<K>[F];
  };

  // Extract embed URL fields from a repeatable item type
  type ItemEmbedFields<K extends keyof RepeatableFields> = {
    [F in keyof RepeatableItemType<K> as RepeatableItemType<K>[F] extends EmbedURL
      ? F
      : never]: RepeatableItemType<K>[F];
  };

  // Extract image fields from a repeatable item type
  type ItemImageFields<K extends keyof RepeatableFields> = {
    [F in keyof RepeatableItemType<K> as ImageValue extends RepeatableItemType<K>[F]
      ? RepeatableItemType<K>[F] extends ImageValue
        ? F
        : never
      : never]: RepeatableItemType<K>[F];
  };

  // Extract file fields from a repeatable item type
  type ItemFileFields<K extends keyof RepeatableFields> = {
    [F in keyof RepeatableItemType<K> as FileValue extends RepeatableItemType<K>[F]
      ? RepeatableItemType<K>[F] extends FileValue
        ? F
        : never
      : never]: RepeatableItemType<K>[F];
  };

  // Extract repeatable array fields from a repeatable item type
  type ItemRepeatableFields<K extends keyof RepeatableFields> = {
    [F in keyof RepeatableItemType<K> as RepeatableItemType<K>[F] extends Array<any>
      ? F
      : never]: RepeatableItemType<K>[F];
  };

  const Field = <K extends keyof StringFields>({
    name,
    children,
  }: {
    name: K;
    children: (content: StringFields[K]) => React.ReactNode;
  }) => {
    const blockContext = React.use(Context);
    if (!blockContext) {
      throw new Error("Field must be used within a Block Component");
    }

    const { blockId, content, mode } = blockContext;
    const isContentEditable = useIsEditable(mode);
    const elementRef = React.useRef<HTMLElement>(null);
    const { window: iframeWindow } = useFrame();

    // Check if we're inside a Repeater
    const repeaterContext = React.use(RepeaterItemContext);

    // Generate unique field ID for overlay tracking
    const fieldId = getOverlayFieldId(blockId, repeaterContext, String(name));

    // Get field value based on context
    const fieldValue = repeaterContext
      ? repeaterContext.itemContent[name]
      : content[name];

    // Track if user is actively editing to prevent React from updating DOM
    const [isEditing, setIsEditing] = React.useState(false);
    const [displayValue, setDisplayValue] =
      React.useState<StringFields[K]>(fieldValue);

    // Local hover/focus state for overlay styling
    const [isHovered, setIsHovered] = React.useState(false);
    const [isFocused, setIsFocused] = React.useState(false);

    // Update display value when field value changes and user is not editing
    React.useEffect(() => {
      if (!isEditing) {
        setDisplayValue(fieldValue);
      }
    }, [fieldValue, isEditing]);

    // Listen for sidebar-triggered hover/focus messages
    const isHoveredFromSidebar = useOverlayMessage(
      iframeWindow,
      isContentEditable,
      "CAMOX_HOVER_FIELD",
      "CAMOX_HOVER_FIELD_END",
      { fieldId },
    );
    const isFocusedFromSidebar = useOverlayMessage(
      iframeWindow,
      isContentEditable,
      "CAMOX_FOCUS_FIELD",
      "CAMOX_FOCUS_FIELD_END",
      { fieldId },
    );

    React.useEffect(() => {
      setIsHovered(isHoveredFromSidebar);
    }, [isHoveredFromSidebar]);

    React.useEffect(() => {
      setIsFocused(isFocusedFromSidebar);
    }, [isFocusedFromSidebar]);

    const updateBlockContent = useMutation(api.blocks.updateBlockContent);
    const updateRepeatableItemContent = useMutation(
      api.repeatableItems.updateRepeatableItemContent,
    );

    const handleInput = (e: React.FormEvent<HTMLElement>) => {
      const newValue = (e.target as HTMLElement).textContent || "";

      if (repeaterContext) {
        const { itemId } = repeaterContext;

        // Update the repeatableItem directly if we have its ID
        if (itemId) {
          updateRepeatableItemContent({
            itemId: itemId,
            content: {
              [name]: newValue,
            },
          });
        }
      } else {
        // We're at the top level - update the field directly
        updateBlockContent({
          blockId,
          content: {
            [name]: newValue,
          },
        });
      }
    };

    const handleFocus = () => {
      setIsEditing(true);
      setIsFocused(true);
      // If we're in a repeater context, select the repeatable item instead of the block
      if (repeaterContext && repeaterContext.itemId) {
        previewStore.send({
          type: "setSelectedRepeatableItem",
          blockId,
          itemId: repeaterContext.itemId,
          fieldName: repeaterContext.arrayFieldName,
        });
      } else {
        previewStore.send({
          type: "setSelectedField",
          blockId,
          fieldName: name.toString(),
          fieldType: "String",
        });
      }
    };

    const handleBlur = () => {
      setIsEditing(false);
      setIsFocused(false);
    };

    const handleMouseEnter = () => {
      if (isContentEditable) {
        setIsHovered(true);
      }
    };

    const handleMouseLeave = () => {
      if (isContentEditable) {
        setIsHovered(false);
      }
    };

    return (
      <Slot
        ref={elementRef}
        data-camox-field-id={isContentEditable ? fieldId : undefined}
        contentEditable={isContentEditable}
        onInput={handleInput}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onKeyDown={(e: React.KeyboardEvent) => {
          if (e.key === "Escape") {
            (e.target as HTMLElement).blur();
          }
        }}
        spellCheck={false}
        suppressContentEditableWarning={true}
        style={
          isContentEditable && (isHovered || isFocused)
            ? {
                outline: `${isFocused ? OVERLAY_WIDTHS.selected : OVERLAY_WIDTHS.hover} solid ${isFocused ? OVERLAY_COLORS.selected : OVERLAY_COLORS.hover}`,
                outlineOffset: isFocused
                  ? OVERLAY_OFFSETS.fieldSelected
                  : OVERLAY_OFFSETS.fieldHover,
              }
            : undefined
        }
      >
        {children(displayValue)}
      </Slot>
    );
  };

  const Embed = <K extends keyof EmbedFields>({
    name,
    children,
  }: {
    name: K;
    children: (url: string) => React.ReactNode;
  }) => {
    const blockContext = React.use(Context);
    if (!blockContext) {
      throw new Error("Embed must be used within a Block Component");
    }

    const { blockId, content, mode } = blockContext;
    const isContentEditable = useIsEditable(mode);
    const { window: iframeWindow } = useFrame();
    const repeaterContext = React.use(RepeaterItemContext);
    const fieldValue = repeaterContext
      ? (repeaterContext.itemContent[name] as string)
      : (content[name] as string);

    const fieldId = getOverlayFieldId(blockId, repeaterContext, String(name));

    const [isOpen, setIsOpen] = React.useState(false);
    const [urlValue, setUrlValue] = React.useState(fieldValue);
    const [isHovered, setIsHovered] = React.useState(false);
    const timerRef = React.useRef<number | null>(null);

    const isHoveredFromSidebar = useOverlayMessage(
      iframeWindow,
      isContentEditable,
      "CAMOX_HOVER_FIELD",
      "CAMOX_HOVER_FIELD_END",
      { fieldId },
    );

    React.useEffect(() => {
      setIsHovered(isHoveredFromSidebar);
    }, [isHoveredFromSidebar]);

    const updateBlockContent = useMutation(api.blocks.updateBlockContent);
    const updateRepeatableItemContent = useMutation(
      api.repeatableItems.updateRepeatableItemContent,
    );

    // Sync urlValue with fieldValue when popover is closed
    React.useEffect(() => {
      if (!isOpen) {
        setUrlValue(fieldValue);
      }
    }, [fieldValue, isOpen]);

    // Cleanup timer on unmount
    React.useEffect(() => {
      return () => {
        if (timerRef.current) {
          clearTimeout(timerRef.current);
        }
      };
    }, []);

    const handleUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = e.target.value;
      setUrlValue(newValue);

      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }

      timerRef.current = window.setTimeout(() => {
        if (repeaterContext?.nested) {
          const { parentItemId, parentContent, nestedFieldName, nestedIndex } =
            repeaterContext.nested;
          const nestedArray = [...(parentContent[nestedFieldName] || [])];
          nestedArray[nestedIndex] = {
            ...nestedArray[nestedIndex],
            [name]: newValue,
          };
          updateRepeatableItemContent({
            itemId: parentItemId,
            content: { [nestedFieldName]: nestedArray },
          });
        } else if (repeaterContext?.itemId) {
          updateRepeatableItemContent({
            itemId: repeaterContext.itemId,
            content: { [name]: newValue },
          });
        } else {
          updateBlockContent({
            blockId,
            content: { [name]: newValue },
          });
        }
      }, 500);
    };

    const handleOpenChange = (open: boolean) => {
      setIsOpen(open);
      if (open) {
        if (repeaterContext?.nested) {
          previewStore.send({
            type: "setSelectedRepeatableItem",
            blockId,
            itemId: repeaterContext.nested.parentItemId,
            fieldName: repeaterContext.nested.parentArrayFieldName,
          });
        } else if (repeaterContext?.itemId) {
          previewStore.send({
            type: "setSelectedRepeatableItem",
            blockId,
            itemId: repeaterContext.itemId,
            fieldName: repeaterContext.arrayFieldName,
          });
        } else {
          previewStore.send({
            type: "setSelectedField",
            blockId,
            fieldName: name.toString(),
            fieldType: "Embed",
          });
        }
      }
    };

    return (
      <Popover
        open={isContentEditable ? isOpen : false}
        onOpenChange={isContentEditable ? handleOpenChange : undefined}
      >
        <PopoverTrigger asChild>
          <div
            style={{ position: "relative" }}
            onMouseEnter={
              isContentEditable ? () => setIsHovered(true) : undefined
            }
            onMouseLeave={
              isContentEditable ? () => setIsHovered(false) : undefined
            }
          >
            {children(fieldValue)}
            {isContentEditable && (
              <>
                {/* Transparent full-coverage overlay to intercept iframe pointer events */}
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    zIndex: 10,
                  }}
                  onClick={() => {
                    if (hasShownEmbedLockToast) return;
                    hasShownEmbedLockToast = true;
                    toast(
                      <span>
                        Hold <Kbd>L</Kbd> to interact with the embed content
                      </span>,
                    );
                  }}
                />
                {(isHovered || isOpen) && (
                  <div
                    style={{
                      position: "absolute",
                      inset: isOpen
                        ? OVERLAY_OFFSETS.blockSelected
                        : OVERLAY_OFFSETS.blockHover,
                      border: `${isOpen ? OVERLAY_WIDTHS.selected : OVERLAY_WIDTHS.hover} solid ${isOpen ? OVERLAY_COLORS.selected : OVERLAY_COLORS.hover}`,
                      pointerEvents: "none",
                      zIndex: 11,
                    }}
                  />
                )}
              </>
            )}
          </div>
        </PopoverTrigger>
        {isContentEditable && (
          <PopoverContent className="w-96 gap-2">
            <form className="grid gap-2">
              <Label htmlFor="url">
                {(options.content[name] as { title?: string })?.title ??
                  String(name)}
              </Label>
              <Input
                type="url"
                id="url"
                value={urlValue}
                onChange={handleUrlChange}
              />
            </form>
          </PopoverContent>
        )}
      </Popover>
    );
  };

  const Link = <K extends keyof LinkFields>({
    name,
    children,
  }: {
    name: K;
    children: (link: {
      text: string;
      href: string;
      newTab: boolean;
    }) => React.ReactNode;
  }) => {
    const blockContext = React.use(Context);
    if (!blockContext) {
      throw new Error("Link must be used within a Block Component");
    }

    const { blockId, content, mode } = blockContext;
    const isContentEditable = useIsEditable(mode);
    const elementRef = React.useRef<HTMLElement>(null);
    const { window: iframeWindow } = useFrame();
    const repeaterContext = React.use(RepeaterItemContext);
    const rawFieldValue = repeaterContext
      ? (repeaterContext.itemContent[name] as LinkValue)
      : (content[name] as LinkValue);
    const fieldValue = normalizeLinkValue(
      rawFieldValue as unknown as Record<string, unknown>,
    );
    const pages = useQuery(api.pages.listPages);
    const resolvedHref = resolveLinkHref(fieldValue, pages);

    const fieldId = getOverlayFieldId(blockId, repeaterContext, String(name));

    const [isEditing, setIsEditing] = React.useState(false);
    const [displayText, setDisplayText] = React.useState(fieldValue.text);
    const [isHovered, setIsHovered] = React.useState(false);
    const [isFocused, setIsFocused] = React.useState(false);

    React.useEffect(() => {
      if (!isEditing) {
        setDisplayText(fieldValue.text);
      }
    }, [fieldValue.text, isEditing]);

    const isHoveredFromSidebar = useOverlayMessage(
      iframeWindow,
      isContentEditable,
      "CAMOX_HOVER_FIELD",
      "CAMOX_HOVER_FIELD_END",
      { fieldId },
    );

    React.useEffect(() => {
      setIsHovered(isHoveredFromSidebar);
    }, [isHoveredFromSidebar]);

    const updateBlockContent = useMutation(api.blocks.updateBlockContent);
    const updateRepeatableItemContent = useMutation(
      api.repeatableItems.updateRepeatableItemContent,
    );

    const saveLinkValue = (newLinkValue: Record<string, unknown>) => {
      if (repeaterContext?.nested) {
        const { parentItemId, parentContent, nestedFieldName, nestedIndex } =
          repeaterContext.nested;
        const nestedArray = [...(parentContent[nestedFieldName] || [])];
        nestedArray[nestedIndex] = {
          ...nestedArray[nestedIndex],
          [name]: newLinkValue,
        };
        updateRepeatableItemContent({
          itemId: parentItemId,
          content: { [nestedFieldName]: nestedArray },
        });
      } else if (repeaterContext?.itemId) {
        updateRepeatableItemContent({
          itemId: repeaterContext.itemId,
          content: { [name]: newLinkValue },
        });
      } else {
        updateBlockContent({
          blockId,
          content: { [name]: newLinkValue },
        });
      }
    };

    const handleInput = (e: React.FormEvent<HTMLElement>) => {
      const newText = (e.target as HTMLElement).textContent || "";
      saveLinkValue({ ...fieldValue, text: newText });
    };

    const buildLinkBreadcrumbs = () => {
      const crumbs: Array<{
        type: "Block" | "RepeatableObject" | "Link";
        id: string;
        fieldName?: string;
      }> = [{ type: "Block", id: blockId }];

      if (repeaterContext?.nested) {
        crumbs.push({
          type: "RepeatableObject",
          id: repeaterContext.nested.parentItemId,
          fieldName: repeaterContext.nested.parentArrayFieldName,
        });
        crumbs.push({
          type: "RepeatableObject",
          id: `idx:${repeaterContext.nested.nestedIndex}`,
          fieldName: repeaterContext.nested.nestedFieldName,
        });
      } else if (repeaterContext?.itemId) {
        crumbs.push({
          type: "RepeatableObject",
          id: repeaterContext.itemId,
          fieldName: repeaterContext.arrayFieldName,
        });
      }

      crumbs.push({
        type: "Link",
        id: String(name),
        fieldName: String(name),
      });

      return crumbs;
    };

    const handleFocus = () => {
      setIsEditing(true);
      setIsFocused(true);
      previewStore.send({
        type: "setSelectionBreadcrumbs",
        breadcrumbs: buildLinkBreadcrumbs(),
      });
    };

    const handleBlur = () => {
      setIsEditing(false);
      setIsFocused(false);
    };

    const handleEditLink = (e: React.MouseEvent) => {
      e.stopPropagation();
      previewStore.send({ type: "toggleContentSheet" });
      setIsFocused(false);
      setIsEditing(false);
    };

    return (
      <Popover open={isContentEditable && isFocused}>
        <PopoverAnchor asChild>
          <Slot
            ref={elementRef}
            data-camox-field-id={isContentEditable ? fieldId : undefined}
            contentEditable={isContentEditable}
            onClick={
              isContentEditable
                ? (e: React.MouseEvent) => e.preventDefault()
                : undefined
            }
            onInput={handleInput}
            onFocus={handleFocus}
            onBlur={handleBlur}
            onMouseEnter={
              isContentEditable ? () => setIsHovered(true) : undefined
            }
            onMouseLeave={
              isContentEditable ? () => setIsHovered(false) : undefined
            }
            onKeyDown={(e: React.KeyboardEvent) => {
              if (e.key === "Escape") {
                (e.target as HTMLElement).blur();
              }
            }}
            spellCheck={false}
            suppressContentEditableWarning={true}
            style={
              isContentEditable && (isHovered || isFocused)
                ? {
                    outline: `${isFocused ? OVERLAY_WIDTHS.selected : OVERLAY_WIDTHS.hover} solid ${isFocused ? OVERLAY_COLORS.selected : OVERLAY_COLORS.hover}`,
                    outlineOffset: isFocused
                      ? OVERLAY_OFFSETS.fieldSelected
                      : OVERLAY_OFFSETS.fieldHover,
                  }
                : undefined
            }
          >
            {children({
              text: displayText,
              href: resolvedHref,
              newTab: fieldValue.newTab,
            })}
          </Slot>
        </PopoverAnchor>
        {isContentEditable && (
          <PopoverContent
            className="w-auto p-2"
            onOpenAutoFocus={(e) => e.preventDefault()}
            align="end"
          >
            <button
              type="button"
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm hover:bg-accent transition-colors"
              onMouseDown={(e) => e.preventDefault()}
              onClick={handleEditLink}
            >
              Edit link
            </button>
          </PopoverContent>
        )}
      </Popover>
    );
  };

  const Image = <K extends keyof ImageFields>({
    name,
    children,
  }: {
    name: K;
    children: (image: ImageValue) => React.ReactNode;
  }) => {
    const blockContext = React.use(Context);
    if (!blockContext) {
      throw new Error("Image must be used within a Block Component");
    }

    const { blockId, content, mode } = blockContext;
    const isContentEditable = useIsEditable(mode);
    const { window: iframeWindow } = useFrame();
    const repeaterContext = React.use(RepeaterItemContext);
    const fieldValue = repeaterContext
      ? (repeaterContext.itemContent[name] as ImageValue)
      : (content[name] as ImageValue);

    const fieldId = getOverlayFieldId(blockId, repeaterContext, String(name));

    const [isHovered, setIsHovered] = React.useState(false);
    const [isFocused, setIsFocused] = React.useState(false);

    const isHoveredFromSidebar = useOverlayMessage(
      iframeWindow,
      isContentEditable,
      "CAMOX_HOVER_FIELD",
      "CAMOX_HOVER_FIELD_END",
      { fieldId },
    );
    const isFocusedFromSidebar = useOverlayMessage(
      iframeWindow,
      isContentEditable,
      "CAMOX_FOCUS_FIELD",
      "CAMOX_FOCUS_FIELD_END",
      { fieldId },
    );

    React.useEffect(() => {
      setIsHovered(isHoveredFromSidebar);
    }, [isHoveredFromSidebar]);

    React.useEffect(() => {
      setIsFocused(isFocusedFromSidebar);
    }, [isFocusedFromSidebar]);

    const buildImageBreadcrumbs = () => {
      const crumbs: Array<{
        type: "Block" | "RepeatableObject" | "Image";
        id: string;
        fieldName?: string;
      }> = [{ type: "Block", id: blockId }];

      if (repeaterContext?.nested) {
        crumbs.push({
          type: "RepeatableObject",
          id: repeaterContext.nested.parentItemId,
          fieldName: repeaterContext.nested.parentArrayFieldName,
        });
        crumbs.push({
          type: "RepeatableObject",
          id: `idx:${repeaterContext.nested.nestedIndex}`,
          fieldName: repeaterContext.nested.nestedFieldName,
        });
      } else if (repeaterContext?.itemId) {
        crumbs.push({
          type: "RepeatableObject",
          id: repeaterContext.itemId,
          fieldName: repeaterContext.arrayFieldName,
        });
      }

      crumbs.push({
        type: "Image",
        id: String(name),
        fieldName: String(name),
      });

      return crumbs;
    };

    const handleClick = () => {
      if (!isContentEditable) return;
      previewStore.send({
        type: "setSelectionBreadcrumbs",
        breadcrumbs: buildImageBreadcrumbs(),
      });
      previewStore.send({ type: "toggleContentSheet" });
    };

    if (!isContentEditable) {
      return <>{children(fieldValue)}</>;
    }

    const showOverlay = isHovered || isFocused;

    return (
      <div
        style={{ position: "relative" }}
        data-camox-field-id={fieldId}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onClick={handleClick}
      >
        {children(fieldValue)}
        {showOverlay && (
          <div
            style={{
              position: "absolute",
              inset: isFocused
                ? OVERLAY_OFFSETS.blockSelected
                : OVERLAY_OFFSETS.blockHover,
              border: `${isFocused ? OVERLAY_WIDTHS.selected : OVERLAY_WIDTHS.hover} solid ${isFocused ? OVERLAY_COLORS.selected : OVERLAY_COLORS.hover}`,
              pointerEvents: "none",
              zIndex: 10,
            }}
          />
        )}
      </div>
    );
  };

  const File = <K extends keyof FileFields>({
    name,
    children,
  }: {
    name: K;
    children: (file: FileValue) => React.ReactNode;
  }) => {
    const blockContext = React.use(Context);
    if (!blockContext) {
      throw new Error("File must be used within a Block Component");
    }

    const { content } = blockContext;
    const repeaterContext = React.use(RepeaterItemContext);
    const fieldValue = repeaterContext
      ? (repeaterContext.itemContent[name] as FileValue)
      : (content[name] as FileValue);

    return <>{children(fieldValue)}</>;
  };

  // RepeaterItemWrapper - wraps each repeater item with overlay support
  const RepeaterItemWrapper = ({
    itemId,
    blockId,
    children,
  }: {
    itemId: string | undefined;
    blockId: Id<"blocks">;
    children: React.ReactNode;
  }) => {
    const isContentEditable = useIsEditable("site");
    const { window: iframeWindow } = useFrame();

    // Check if the parent repeater container is being hovered from sidebar
    const isRepeaterHovered = React.useContext(RepeaterHoverContext);

    const isHovered = useOverlayMessage(
      iframeWindow,
      isContentEditable,
      "CAMOX_HOVER_REPEATER_ITEM",
      "CAMOX_HOVER_REPEATER_ITEM_END",
      { blockId, itemId },
    );

    const showOverlay = isContentEditable && (isHovered || isRepeaterHovered);

    return (
      <div
        style={{ position: "relative" }}
        data-camox-repeater-item-id={isContentEditable ? itemId : undefined}
      >
        {children}
        {showOverlay && (
          <div
            style={{
              position: "absolute",
              inset: OVERLAY_OFFSETS.blockHover,
              border: `${OVERLAY_WIDTHS.hover} solid ${OVERLAY_COLORS.hover}`,
              pointerEvents: "none",
              zIndex: 10,
            }}
          />
        )}
      </div>
    );
  };

  // RepeaterHoverProvider - provides hover state to child items without adding DOM elements
  const RepeaterHoverProvider = ({
    blockId,
    fieldName,
    children,
  }: {
    blockId: Id<"blocks">;
    fieldName: string;
    children: React.ReactNode;
  }) => {
    const isContentEditable = useIsEditable("site");
    const { window: iframeWindow } = useFrame();

    const isHovered = useOverlayMessage(
      iframeWindow,
      isContentEditable,
      "CAMOX_HOVER_REPEATER",
      "CAMOX_HOVER_REPEATER_END",
      { blockId, fieldName },
    );

    return (
      <RepeaterHoverContext.Provider value={isHovered}>
        {children}
      </RepeaterHoverContext.Provider>
    );
  };

  const Repeater = <K extends keyof RepeatableFields>({
    name,
    children,
  }: {
    name: K;
    children: (
      item: {
        Field: <F extends keyof ItemStringFields<K>>(props: {
          name: F;
          children: (content: ItemStringFields<K>[F]) => React.ReactNode;
        }) => React.ReactNode;
        Link: <F extends keyof ItemLinkFields<K>>(props: {
          name: F;
          children: (link: {
            text: string;
            href: string;
            newTab: boolean;
          }) => React.ReactNode;
        }) => React.ReactNode;
        Embed: <F extends keyof ItemEmbedFields<K>>(props: {
          name: F;
          children: (url: string) => React.ReactNode;
        }) => React.ReactNode;
        Image: <F extends keyof ItemImageFields<K>>(props: {
          name: F;
          children: (image: ImageValue) => React.ReactNode;
        }) => React.ReactNode;
        File: <F extends keyof ItemFileFields<K>>(props: {
          name: F;
          children: (file: FileValue) => React.ReactNode;
        }) => React.ReactNode;
        Repeater: <F extends keyof ItemRepeatableFields<K>>(props: {
          name: F;
          children: (
            item: {
              Field: (props: {
                name: string;
                children: (content: any) => React.ReactNode;
              }) => React.ReactNode;
              Link: (props: {
                name: string;
                children: (link: {
                  text: string;
                  href: string;
                  newTab: boolean;
                }) => React.ReactNode;
              }) => React.ReactNode;
              Embed: (props: {
                name: string;
                children: (url: string) => React.ReactNode;
              }) => React.ReactNode;
              Image: (props: {
                name: string;
                children: (image: ImageValue) => React.ReactNode;
              }) => React.ReactNode;
              File: (props: {
                name: string;
                children: (file: FileValue) => React.ReactNode;
              }) => React.ReactNode;
              Repeater: (props: {
                name: string;
                children: (item: any, index: number) => React.ReactNode;
              }) => React.ReactNode;
            },
            index: number,
          ) => React.ReactNode;
        }) => React.ReactNode;
      },
      index: number,
    ) => React.ReactNode;
  }) => {
    const blockContext = React.use(Context);
    if (!blockContext) {
      throw new Error("Repeater must be used within a Block Component");
    }

    const { blockId, content } = blockContext;

    // Check if we're inside another repeater (nested)
    const parentRepeaterContext = React.use(RepeaterItemContext);
    const fieldName = String(name);

    // Type-cast components to work with item fields
    // This is safe because each component checks RepeaterItemContext at runtime
    const ItemField = Field as <F extends keyof ItemStringFields<K>>(props: {
      name: F;
      children: (content: ItemStringFields<K>[F]) => React.ReactNode;
    }) => React.ReactNode;

    const ItemLink = Link as <F extends keyof ItemLinkFields<K>>(props: {
      name: F;
      children: (link: {
        text: string;
        href: string;
        newTab: boolean;
      }) => React.ReactNode;
    }) => React.ReactNode;

    const ItemEmbed = Embed as <F extends keyof ItemEmbedFields<K>>(props: {
      name: F;
      children: (url: string) => React.ReactNode;
    }) => React.ReactNode;

    const ItemImage = Image as <F extends keyof ItemImageFields<K>>(props: {
      name: F;
      children: (image: ImageValue) => React.ReactNode;
    }) => React.ReactNode;

    const ItemFile = File as <F extends keyof ItemFileFields<K>>(props: {
      name: F;
      children: (file: FileValue) => React.ReactNode;
    }) => React.ReactNode;

    const ItemRepeater = Repeater as <
      F extends keyof ItemRepeatableFields<K>,
    >(props: {
      name: F;
      children: (
        item: {
          Field: (props: {
            name: string;
            children: (content: any) => React.ReactNode;
          }) => React.ReactNode;
          Link: (props: {
            name: string;
            children: (link: {
              text: string;
              href: string;
              newTab: boolean;
            }) => React.ReactNode;
          }) => React.ReactNode;
          Embed: (props: {
            name: string;
            children: (url: string) => React.ReactNode;
          }) => React.ReactNode;
          Image: (props: {
            name: string;
            children: (image: ImageValue) => React.ReactNode;
          }) => React.ReactNode;
          File: (props: {
            name: string;
            children: (file: FileValue) => React.ReactNode;
          }) => React.ReactNode;
          Repeater: (props: {
            name: string;
            children: (item: any, index: number) => React.ReactNode;
          }) => React.ReactNode;
        },
        index: number,
      ) => React.ReactNode;
    }) => React.ReactNode;

    const itemComponents = {
      Field: ItemField,
      Link: ItemLink,
      Embed: ItemEmbed,
      Image: ItemImage,
      File: ItemFile,
      Repeater: ItemRepeater,
    };

    // Nested repeater: items are plain objects in parent item's content
    if (parentRepeaterContext) {
      const nestedArray = (parentRepeaterContext.itemContent[name] ??
        []) as any[];

      if (!Array.isArray(nestedArray)) {
        throw new Error(`Field "${String(name)}" is not an array`);
      }

      const parentItemId = parentRepeaterContext.itemId!;

      return (
        <RepeaterHoverProvider blockId={blockId} fieldName={fieldName}>
          {nestedArray.map((item: any, index: number) => {
            const nestedItemId = `nested:${parentItemId}:${fieldName}:${index}`;
            return (
              <RepeaterItemContext.Provider
                key={index}
                value={{
                  arrayFieldName: fieldName,
                  itemIndex: index,
                  itemContent: item,
                  nested: {
                    parentItemId,
                    parentContent: parentRepeaterContext.itemContent,
                    parentArrayFieldName: parentRepeaterContext.arrayFieldName,
                    nestedFieldName: fieldName,
                    nestedIndex: index,
                  },
                }}
              >
                <RepeaterItemWrapper itemId={nestedItemId} blockId={blockId}>
                  {children(itemComponents, index)}
                </RepeaterItemWrapper>
              </RepeaterItemContext.Provider>
            );
          })}
        </RepeaterHoverProvider>
      );
    }

    // Top-level repeater: items are { _id, content, ... } documents
    const arrayValue = (content[name] ?? []) as RepeatableFields[K];

    if (!Array.isArray(arrayValue)) {
      throw new Error(`Field "${String(name)}" is not an array`);
    }

    // For image arrays, hide placeholder items when real images exist
    let filteredArray = arrayValue;
    if (arrayValue.length > 0 && (arrayValue as any[])[0]?.content?.image?.url) {
      const hasReal = (arrayValue as any[]).some(
        (item: any) =>
          item.content?.image?.url &&
          !item.content.image.url.includes("placehold.co"),
      );
      if (hasReal) {
        filteredArray = (arrayValue as any[]).filter(
          (item: any) => !item.content?.image?.url?.includes("placehold.co"),
        ) as typeof arrayValue;
      }
    }

    type TItem = RepeatableItemType<K>;

    return (
      <RepeaterHoverProvider blockId={blockId} fieldName={fieldName}>
        {filteredArray.map((item: any, index: number) => {
          const itemContent = item.content as TItem;
          const itemId = item._id as Id<"repeatableItems"> | undefined;

          return (
            <RepeaterItemContext.Provider
              key={itemId || index}
              value={{
                arrayFieldName: fieldName,
                itemIndex: index,
                itemContent: itemContent,
                itemId: itemId,
              }}
            >
              <RepeaterItemWrapper itemId={itemId} blockId={blockId}>
                {children(itemComponents, index)}
              </RepeaterItemWrapper>
            </RepeaterItemContext.Provider>
          );
        })}
      </RepeaterHoverProvider>
    );
  };

  const BlockComponent = ({
    blockData,
    mode,
    isFirstBlock,
  }: BlockComponentProps<TContent>) => {
    const isContentEditable = useIsEditable(mode);
    const { window: iframeWindow } = useFrame();

    // Local state for hover
    const [isHovered, setIsHovered] = React.useState(false);

    // Scroll into view when editing in preview
    const selectionBreadcrumbs = useSelector(
      previewStore,
      (state) => state.context.selectionBreadcrumbs,
    );
    const isPageContentSheetOpen = useSelector(
      previewStore,
      (state) => state.context.isPageContentSheetOpen,
    );
    const isAddBlockSheetOpen = useSelector(
      previewStore,
      (state) => state.context.isAddBlockSheetOpen,
    );
    const isAnySideSheetOpen = useIsPreviewSheetOpen();
    const focusedBlockId = selectionBreadcrumbs[0]?.id ?? null;
    const isBlockSelected = focusedBlockId === blockData._id;
    const ref = React.useRef<HTMLDivElement>(null);

    // Track first render because we won't animate the scroll into view for it
    const [isFirstRender, setIsFirstRender] = React.useState(true);
    React.useEffect(() => {
      if (isFirstRender) {
        setIsFirstRender(false);
      }
    }, [isFirstRender]);

    // Scroll block into view when selected or when content sheet opens
    React.useEffect(() => {
      if (isBlockSelected && ref.current) {
        ref.current.scrollIntoView({
          behavior: isFirstRender ? "instant" : "smooth",
          block: isFirstRender ? "start" : "nearest",
        });
      }
    }, [isBlockSelected, isFirstRender, isPageContentSheetOpen]);

    // Listen for sidebar-triggered hover messages
    const isHoveredFromSidebar = useOverlayMessage(
      iframeWindow,
      isContentEditable,
      "CAMOX_HOVER_BLOCK",
      "CAMOX_HOVER_BLOCK_END",
      { blockId: blockData._id },
    );

    React.useEffect(() => {
      setIsHovered(isHoveredFromSidebar);
    }, [isHoveredFromSidebar]);

    // Normalize content: keep full item objects for internal use, but prepare content-only version for display
    // We need to keep blockData.content as-is because Repeater needs the full objects with _id
    // But we also need to pass to options.component for the content prop (used in non-Repeater contexts)
    const normalizedContent = React.useMemo(() => {
      const result = { ...blockData.content } as any;

      // Transform array fields from full item objects to content-only for the component prop
      for (const key in result) {
        const value = result[key];
        if (
          Array.isArray(value) &&
          value.length > 0 &&
          value[0]?.content !== undefined
        ) {
          let items = value;
          // For image arrays, filter out placeholders when real images exist
          if (items[0]?.content?.image?.url) {
            const hasReal = items.some(
              (item: any) =>
                item.content?.image?.url &&
                !item.content.image.url.includes("placehold.co"),
            );
            if (hasReal) {
              items = items.filter(
                (item: any) => !item.content?.image?.url?.includes("placehold.co"),
              );
            }
          }
          // Extract just the content for the component prop
          result[key] = items.map((item: any) => item.content);
        }
      }

      return result as TContent;
    }, [blockData.content]);

    const handleClick = (e: React.MouseEvent) => {
      if (!isContentEditable) return;

      // Don't select block if clicking on a field
      const target = e.target as HTMLElement;
      if (target.closest("[data-camox-field-id]")) return;

      previewStore.send({ type: "setFocusedBlock", blockId: blockData._id });
    };

    const handleMouseEnter = () => {
      if (isContentEditable) {
        setIsHovered(true);
      }
    };

    const handleMouseLeave = () => {
      if (isContentEditable) {
        setIsHovered(false);
      }
    };

    const handleAddBlockClick = (insertPosition: "before" | "after") => {
      postOverlayMessage({
        type: "CAMOX_ADD_BLOCK_REQUEST",
        blockPosition: blockData.position,
        insertPosition,
      });
    };

    // The bright colors overlays to show selection and editable content
    const shouldShowOverlay =
      isContentEditable &&
      (isHovered || isBlockSelected) &&
      !isAddBlockSheetOpen;

    // The overlay to darken everything but one block when a preview sheet is open
    const shouldShowSheetOverlay =
      // When adding a block elsewhere
      (isAddBlockSheetOpen && mode !== "peek") ||
      // Another block is being edited in the sheet
      (isPageContentSheetOpen && !isBlockSelected);

    return (
      <div
        className="group visual-editing-block"
        ref={ref}
        style={{
          position: "relative",
          scrollMargin: "5rem",
          background: "var(--background)",
        }}
        data-camox-block-id={isContentEditable ? blockData._id : undefined}
        onClick={handleClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <Context.Provider
          value={{
            blockId: blockData._id,
            content: { ...contentDefaults, ...blockData.content },
            settings: {
              ...settingsDefaults,
              ...blockData.settings,
            } as TSettings,
            mode,
          }}
        >
          <options.component content={normalizedContent} />
        </Context.Provider>
        {/* Sheet overlay */}
        <div
          style={{
            position: "absolute",
            width: "100%",
            height: "100%",
            top: 0,
            left: 0,
            background: "#000",
            opacity: shouldShowSheetOverlay ? 0.6 : 0,
            transition: "opacity 0.3s ease-in-out",
            pointerEvents: "none",
            zIndex: 20,
          }}
          id="hello"
        />
        {/* Overlay UI */}
        {shouldShowOverlay && (
          <>
            {/* Border overlay */}
            <div
              style={{
                position: "absolute",
                inset: isBlockSelected
                  ? OVERLAY_OFFSETS.blockSelected
                  : OVERLAY_OFFSETS.blockHover,
                border: `${isBlockSelected ? OVERLAY_WIDTHS.selected : OVERLAY_WIDTHS.hover} solid ${isBlockSelected ? OVERLAY_COLORS.selected : OVERLAY_COLORS.hover}`,
                pointerEvents: "none",
                zIndex: 10,
              }}
            />

            {/* Top control bar - add block above (hidden for first block) */}
            {!isFirstBlock && (
              <AddBlockControlBar
                position="top"
                hidden={isAnySideSheetOpen}
                onMouseLeave={() => setIsHovered(false)}
                onClick={() => handleAddBlockClick("before")}
              />
            )}

            {/* Bottom control bar - add block below */}
            <AddBlockControlBar
              position="bottom"
              hidden={isAnySideSheetOpen}
              onMouseLeave={() => setIsHovered(false)}
              onClick={() => handleAddBlockClick("after")}
            />
          </>
        )}
      </div>
    );
  };

  const useSetting = <K extends keyof TSettings>(name: K): TSettings[K] => {
    const ctx = React.use(Context);
    if (!ctx) {
      throw new Error("useSetting must be used within a Block Component");
    }
    return ctx.settings[name];
  };

  return {
    /**
     * The react component to be used at the page level when mapping on blocks content.
     * It exposes context that will be consumed by the Field component, and provides visual editing
     * capabilities (e.g. delete and reorder blocks).
     */
    Component: BlockComponent,
    Field,
    Embed,
    Link,
    Image,
    File,
    Repeater,
    useSetting,
    id: options.id,
    title: options.title,
    description: options.description,
    contentSchema,
    settingsSchema,
    getInitialContent: () => {
      return { ...contentDefaults } as TContent;
    },
    getInitialSettings: () => {
      return { ...settingsDefaults };
    },
  };
}

export type Block = ReturnType<typeof createBlock>;
