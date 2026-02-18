import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { useSelector } from "@xstate/store/react";
import { useClerk } from "@clerk/clerk-react";
import { useMutation } from "convex/react";
import {
  Type as TypeBoxType,
  type TSchema,
  type Static,
} from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { api } from "camox/_generated/api";
import { previewStore } from "../features/preview/previewStore";
import {
  isOverlayMessage,
  postOverlayMessage,
} from "../features/preview/overlayMessages";
import {
  OVERLAY_COLORS,
  OVERLAY_WIDTHS,
  OVERLAY_OFFSETS,
} from "../features/preview/overlayConstants";
import { useFrame } from "../components/ui/frame";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "../components/ui/popover";
import { Input } from "../components/ui/input";
import { toast } from "../components/ui/toaster";
import { Kbd } from "../components/ui/kbd";
import type { Id } from "camox/_generated/dataModel";
import type { FieldType } from "./fieldTypes.tsx";

/* -------------------------------------------------------------------------------------------------
 * EmbedURL branded type
 * -----------------------------------------------------------------------------------------------*/

declare const EmbedURLBrand: unique symbol;
type EmbedURL = string & { readonly [EmbedURLBrand]: true };

/* -------------------------------------------------------------------------------------------------
 * Typebox wrapper used for content schemas
 * -----------------------------------------------------------------------------------------------*/

/**
 * Type builders for createBlock content schemas.
 * All fields must have default values.
 */
export const Type = {
  /**
   * Creates a string field with a required default value.
   *
   * @example
   * Type.String({ default: 'Hello' })
   * Type.String({ default: 'Hello', maxLength: 100, title: 'Title' })
   */
  String: (options: {
    default: string;
    title?: string;
    maxLength?: number;
    minLength?: number;
    pattern?: string;
  }) => {
    return TypeBoxType.String({
      ...options,
      fieldType: "String" as const,
    });
  },

  /**
   * Creates a repeatable array of objects.
   * Arrays and objects must always be used together - no standalone arrays or objects.
   * The default array is auto-generated based on minItems.
   *
   * @example
   * Type.RepeatableObject({
   *   title: Type.String({ default: 'Item' }),
   *   description: Type.String({ default: 'Description' })
   * }, {
   *   minItems: 1,
   *   maxItems: 10,
   *   title: 'Items'
   * })
   */
  RepeatableObject: <T extends Record<string, TSchema>>(
    shape: T,
    options: { minItems: number; maxItems: number; title?: string },
  ) => {
    if (options.minItems < 1) {
      throw new Error("RepeatableObject requires minItems to be at least 1");
    }

    const objectSchema = TypeBoxType.Object(shape);

    // Auto-generate default array using Value.Create
    const defaultItem = Value.Create(objectSchema);
    const defaultArray = Array(options.minItems)
      .fill(null)
      .map(() => ({ ...defaultItem }));

    return TypeBoxType.Array(objectSchema, {
      minItems: options.minItems,
      maxItems: options.maxItems,
      default: defaultArray,
      title: options.title,
      fieldType: "RepeatableObject" as const,
    });
  },

  /**
   * Creates an enum field with a set of predefined options.
   *
   * @example
   * Type.Enum({
   *   default: 'left',
   *   options: { left: 'Left', center: 'Center', right: 'Right' },
   *   title: 'Alignment'
   * })
   */
  Enum: (options: {
    default: string;
    options: Record<string, string>;
    title?: string;
  }) => {
    const enumValues = Object.keys(options.options);
    return TypeBoxType.Unsafe<string>({
      type: "string",
      enum: enumValues,
      default: options.default,
      title: options.title,
      enumLabels: options.options,
      fieldType: "Enum" as const,
    });
  },

  /**
   * Creates a boolean toggle field.
   *
   * @example
   * Type.Boolean({ default: false, title: 'Show background' })
   */
  Boolean: (options: { default: boolean; title?: string }) => {
    return TypeBoxType.Boolean({
      default: options.default,
      title: options.title,
      fieldType: "Boolean" as const,
    });
  },

  /**
   * Creates an embed field for URLs matching a specific pattern.
   *
   * @example
   * Type.Embed({
   *   pattern: 'https:\\/\\/(www\\.)?youtube\\.com\\/watch\\?v=.+',
   *   default: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
   *   title: 'YouTube URL'
   * })
   */
  Embed: (options: { pattern: string; default: string; title?: string }) => {
    if (!new RegExp(options.pattern).test(options.default)) {
      throw new Error(
        `Embed default value "${options.default}" does not match pattern "${options.pattern}"`,
      );
    }
    return TypeBoxType.Unsafe<EmbedURL>({
      type: "string",
      pattern: options.pattern,
      default: options.default,
      title: options.title,
      fieldType: "Embed" as const,
    });
  },
} satisfies Record<FieldType, unknown>;

/* -------------------------------------------------------------------------------------------------
 * useIsEditable
 * -----------------------------------------------------------------------------------------------*/

function useIsEditable(mode: BlockComponentProps<any>["mode"]) {
  const { isSignedIn } = useClerk();
  const isPresentationMode = useSelector(
    previewStore,
    (state) => state.context.isPresentationMode,
  );
  const isContentLocked = useSelector(
    previewStore,
    (state) => state.context.isContentLocked,
  );
  return (
    isSignedIn && mode === "site" && !isPresentationMode && !isContentLocked
  );
}

/* -------------------------------------------------------------------------------------------------
 * AddBlockControlBar
 * -----------------------------------------------------------------------------------------------*/

interface AddBlockControlBarProps {
  position: "top" | "bottom";
  hidden: boolean;
  onClick: () => void;
  onMouseLeave: () => void;
}

const AddBlockControlBar = ({
  position,
  hidden,
  onClick,
  onMouseLeave,
}: AddBlockControlBarProps) => {
  const [isExpanded, setIsExpanded] = React.useState(false);

  return (
    <div
      style={{
        position: "absolute",
        top: position === "top" ? 0 : undefined,
        bottom: position === "bottom" ? 0 : undefined,
        left: 0,
        right: 0,
        height: "36px",
        transform: position === "top" ? "translateY(-50%)" : "translateY(50%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 11,
        opacity: hidden ? 0 : 1,
        pointerEvents: hidden ? "none" : "auto",
        transition: "opacity 150ms ease",
      }}
      onMouseLeave={onMouseLeave}
    >
      <div
        style={{
          width: "120px",
          height: "36px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
        onMouseEnter={() => setIsExpanded(true)}
        onMouseLeave={() => setIsExpanded(false)}
      >
        <button
          style={{
            display: "flex",
            alignItems: "center",
            gap: isExpanded ? "4px" : "0px",
            padding: isExpanded ? "4px 8px" : "0px",
            width: isExpanded ? "auto" : "20px",
            height: isExpanded ? "auto" : "20px",
            justifyContent: "center",
            backgroundColor: OVERLAY_COLORS.selected,
            color: "white",
            border: "none",
            borderRadius: "9999px",
            fontSize: "12px",
            fontWeight: 500,
            cursor: "pointer",
            whiteSpace: "nowrap",
            transition: "all 150ms ease",
          }}
          onClick={onClick}
        >
          <span style={{ lineHeight: 1 }}>+</span>
          {isExpanded && <span>Add block</span>}
        </button>
      </div>
    </div>
  );
};

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
  mode: "site" | "peek" | "playground";
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
  }

  const Context = React.createContext<BlockContextValue | null>(null);
  const RepeaterItemContext =
    React.createContext<RepeaterItemContextValue | null>(null);

  // Context to track if the parent repeater container is being hovered from sidebar
  const RepeaterHoverContext = React.createContext<boolean>(false);

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
    const fieldId = repeaterContext?.itemId
      ? `${blockId}__${repeaterContext.itemId}__${String(name)}`
      : `${blockId}__${String(name)}`;

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

    // Listen for sidebar-triggered hover messages
    React.useEffect(() => {
      if (!isContentEditable || !iframeWindow) return;

      const handleMessage = (event: MessageEvent) => {
        if (!isOverlayMessage(event.data)) return;
        if (
          event.data.type === "CAMOX_HOVER_FIELD" &&
          event.data.fieldId === fieldId
        ) {
          setIsHovered(true);
        }
        if (
          event.data.type === "CAMOX_HOVER_FIELD_END" &&
          event.data.fieldId === fieldId
        ) {
          setIsHovered(false);
        }
        if (
          event.data.type === "CAMOX_FOCUS_FIELD" &&
          event.data.fieldId === fieldId
        ) {
          setIsFocused(true);
        }
        if (
          event.data.type === "CAMOX_FOCUS_FIELD_END" &&
          event.data.fieldId === fieldId
        ) {
          setIsFocused(false);
        }
      };

      iframeWindow.addEventListener("message", handleMessage);
      return () => iframeWindow.removeEventListener("message", handleMessage);
    }, [isContentEditable, fieldId, iframeWindow]);

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
    const fieldValue = content[name] as string;

    const [isOpen, setIsOpen] = React.useState(false);
    const [urlValue, setUrlValue] = React.useState(fieldValue);
    const [isHovered, setIsHovered] = React.useState(false);
    const timerRef = React.useRef<number | null>(null);

    const updateBlockContent = useMutation(api.blocks.updateBlockContent);

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
        updateBlockContent({
          blockId,
          content: { [name]: newValue },
        });
      }, 500);
    };

    const handleOpenChange = (open: boolean) => {
      setIsOpen(open);
      if (open) {
        previewStore.send({
          type: "setSelectedField",
          blockId,
          fieldName: name.toString(),
          fieldType: "Embed",
        });
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
                  onClick={() =>
                    toast(
                      <span>
                        Hold <Kbd>L</Kbd> to interact with the embed content
                      </span>,
                    )
                  }
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
          <PopoverContent>
            <Input type="url" value={urlValue} onChange={handleUrlChange} />
          </PopoverContent>
        )}
      </Popover>
    );
  };

  // RepeaterItemWrapper - wraps each repeater item with overlay support
  const RepeaterItemWrapper = ({
    itemId,
    blockId,
    children,
  }: {
    itemId: Id<"repeatableItems"> | undefined;
    blockId: Id<"blocks">;
    children: React.ReactNode;
  }) => {
    const isContentEditable = useIsEditable("site");
    const { window: iframeWindow } = useFrame();
    const [isHovered, setIsHovered] = React.useState(false);

    // Check if the parent repeater container is being hovered from sidebar
    const isRepeaterHovered = React.useContext(RepeaterHoverContext);

    // Listen for CAMOX_HOVER_REPEATER_ITEM messages
    React.useEffect(() => {
      if (!isContentEditable || !iframeWindow || !itemId) return;

      const handleMessage = (event: MessageEvent) => {
        if (!isOverlayMessage(event.data)) return;
        if (
          event.data.type === "CAMOX_HOVER_REPEATER_ITEM" &&
          event.data.blockId === blockId &&
          event.data.itemId === itemId
        ) {
          setIsHovered(true);
        }
        if (
          event.data.type === "CAMOX_HOVER_REPEATER_ITEM_END" &&
          event.data.blockId === blockId &&
          event.data.itemId === itemId
        ) {
          setIsHovered(false);
        }
      };

      iframeWindow.addEventListener("message", handleMessage);
      return () => iframeWindow.removeEventListener("message", handleMessage);
    }, [isContentEditable, blockId, itemId, iframeWindow]);

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
    const [isHovered, setIsHovered] = React.useState(false);

    // Listen for CAMOX_HOVER_REPEATER messages
    React.useEffect(() => {
      if (!isContentEditable || !iframeWindow) return;

      const handleMessage = (event: MessageEvent) => {
        if (!isOverlayMessage(event.data)) return;
        if (
          event.data.type === "CAMOX_HOVER_REPEATER" &&
          event.data.blockId === blockId &&
          event.data.fieldName === fieldName
        ) {
          setIsHovered(true);
        }
        if (
          event.data.type === "CAMOX_HOVER_REPEATER_END" &&
          event.data.blockId === blockId &&
          event.data.fieldName === fieldName
        ) {
          setIsHovered(false);
        }
      };

      iframeWindow.addEventListener("message", handleMessage);
      return () => iframeWindow.removeEventListener("message", handleMessage);
    }, [isContentEditable, blockId, fieldName, iframeWindow]);

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
      },
      index: number,
    ) => React.ReactNode;
  }) => {
    const blockContext = React.use(Context);
    if (!blockContext) {
      throw new Error("Repeater must be used within a Block Component");
    }

    const { blockId, content } = blockContext;

    const arrayValue = content[name] as RepeatableFields[K];

    if (!Array.isArray(arrayValue)) {
      throw new Error(`Field "${String(name)}" is not an array`);
    }

    const fieldName = String(name);

    type TItem = RepeatableItemType<K>;

    // Type-cast Field to work with item fields
    // This is safe because Field checks RepeaterItemContext at runtime
    const ItemField = Field as <F extends keyof ItemStringFields<K>>(props: {
      name: F;
      children: (content: ItemStringFields<K>[F]) => React.ReactNode;
    }) => React.ReactNode;

    return (
      <RepeaterHoverProvider blockId={blockId} fieldName={fieldName}>
        {arrayValue.map((item: any, index: number) => {
          // Extract the content and _id from the full item object
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
                {children({ Field: ItemField }, index)}
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
    const isAnySideSheetOpen = isPageContentSheetOpen || isAddBlockSheetOpen;
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
    React.useEffect(() => {
      if (!isContentEditable || !iframeWindow) return;

      const handleMessage = (event: MessageEvent) => {
        if (!isOverlayMessage(event.data)) return;
        if (
          event.data.type === "CAMOX_HOVER_BLOCK" &&
          event.data.blockId === blockData._id
        ) {
          setIsHovered(true);
        }
        if (
          event.data.type === "CAMOX_HOVER_BLOCK_END" &&
          event.data.blockId === blockData._id
        ) {
          setIsHovered(false);
        }
      };

      iframeWindow.addEventListener("message", handleMessage);
      return () => iframeWindow.removeEventListener("message", handleMessage);
    }, [isContentEditable, blockData._id, iframeWindow]);

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
          // This is an array of full item objects - extract just the content for the component prop
          result[key] = value.map((item: any) => item.content);
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

    const showOverlay = isContentEditable && (isHovered || isBlockSelected);

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
            content: blockData.content,
            settings: {
              ...settingsDefaults,
              ...blockData.settings,
            } as TSettings,
            mode,
          }}
        >
          <options.component content={normalizedContent} />
        </Context.Provider>

        {/* Overlay UI */}
        {showOverlay && (
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
