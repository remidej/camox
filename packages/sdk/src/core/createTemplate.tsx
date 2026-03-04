import * as React from "react";

/* -------------------------------------------------------------------------------------------------
 * createTemplate
 * -----------------------------------------------------------------------------------------------*/

export interface TemplateBlockData {
  _id: string;
  type: string;
  content: Record<string, unknown>;
  settings?: Record<string, unknown>;
  position: string;
}

/** Minimal block interface — avoids importing the full generic Block type. */
interface TemplateBlock {
  id: string;
  Component: React.ComponentType<{
    blockData: any;
    mode: "site" | "peek" | "template";
    isFirstBlock?: boolean;
    showAddBlockTop?: boolean;
    showAddBlockBottom?: boolean;
    addBlockAfterPosition?: string | null;
  }>;
  getInitialContent: () => Record<string, unknown>;
  getInitialSettings: () => Record<string, unknown>;
}

interface CreateTemplateOptions {
  id: string;
  title: string;
  description: string;
  blocks: { before: TemplateBlock[]; after: TemplateBlock[] };
  component: React.ComponentType<{ children: React.ReactNode }>;
}

function toPascalCase(str: string): string {
  return str
    .split(/[-_\s]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");
}

export function createTemplate(options: CreateTemplateOptions) {
  // Each template gets its own context — avoids cross-module identity issues
  const TemplateContext = React.createContext<{
    templateBlocks: Record<string, TemplateBlockData>;
  } | null>(null);

  const allBlocks = [...options.blocks.before, ...options.blocks.after];

  // Build slot components keyed by PascalCase(block.id)
  const slotComponents: Record<string, React.ComponentType> = {};

  const lastBeforeBlock = options.blocks.before[options.blocks.before.length - 1];
  const firstAfterBlock = options.blocks.after[0];

  for (const block of allBlocks) {
    const isLastBefore = block === lastBeforeBlock;
    const isFirstAfter = block === firstAfterBlock;

    const SlotComponent = () => {
      const ctx = React.use(TemplateContext);
      if (!ctx) {
        throw new Error(
          `Template slot "${block.id}" must be rendered inside a TemplateContextProvider`,
        );
      }

      const blockData = ctx.templateBlocks[block.id];
      if (!blockData) return null;

      return (
        <block.Component
          blockData={blockData}
          mode="template"
          showAddBlockTop={isFirstAfter || undefined}
          showAddBlockBottom={isLastBefore || undefined}
          addBlockAfterPosition={(() => {
            if (isLastBefore) return "";
            if (isFirstAfter) return null;
            return undefined;
          })()}
        />
      );
    };
    SlotComponent.displayName = `TemplateSlot(${toPascalCase(block.id)})`;
    slotComponents[toPascalCase(block.id)] = SlotComponent;
  }

  // Provider component that wraps the template — shares context with slots
  const Provider = ({
    templateBlocks,
    children,
  }: {
    templateBlocks: Record<string, TemplateBlockData>;
    children: React.ReactNode;
  }) => {
    const value = React.useMemo(
      () => ({ templateBlocks }),
      [templateBlocks],
    );
    return (
      <TemplateContext.Provider value={value}>
        {children}
      </TemplateContext.Provider>
    );
  };

  // Build block definitions array for sync
  const blockDefinitions = [
    ...options.blocks.before.map((block) => ({
      type: block.id,
      content: block.getInitialContent(),
      settings: block.getInitialSettings(),
      placement: "before" as const,
    })),
    ...options.blocks.after.map((block) => ({
      type: block.id,
      content: block.getInitialContent(),
      settings: block.getInitialSettings(),
      placement: "after" as const,
    })),
  ];

  return {
    id: options.id,
    title: options.title,
    description: options.description,
    blockDefinitions,
    component: options.component,
    Provider,
    blocks: slotComponents as Record<string, React.ComponentType>,
  };
}

export type Template = ReturnType<typeof createTemplate>;
