import * as React from "react";

import type { Collection } from "../createCollection";
import type { LoadedRecord } from "../requestContext";
import type { BlockComponentProps, createEditableBlock } from "./createEditableBlock";

/** The options a block was defined with. */
export type BlockOptions = Parameters<typeof createEditableBlock>[0];

/** The components a block renders its fields with, which the runtime makes editable. */
export type EditingPrimitive =
  | "Field"
  | "Icon"
  | "Embed"
  | "Artifact"
  | "Link"
  | "Image"
  | "File"
  | "ImageList"
  | "FileList"
  | "Reference"
  | "ReferenceList"
  | "Repeater"
  | "Detached";

export interface BlockEditingRuntime {
  // Keep the hook prefix so React Compiler never memoizes the context read.
  useSetting(options: BlockOptions, name: string): unknown;
  renderBlock(
    options: BlockOptions,
    props: BlockComponentProps<Record<string, unknown>>,
  ): React.ReactNode;
  renderPrimitive(
    options: BlockOptions,
    primitive: EditingPrimitive,
    props: Record<string, unknown>,
  ): React.ReactNode;
  /** Renders a record page's record, editable like a referenced record. */
  renderLayoutItem?(props: LayoutItemProps): React.ReactNode;
}

/** A record page's record, as `layout.Item` hands it to the editing runtime. */
export interface LayoutItemProps {
  collectionId: string;
  /** The record's collection, whose templates title and describe it. */
  collection: Collection;
  /** The collection's field schemas. */
  properties: Record<string, unknown>;
  record: LoadedRecord;
  children: (scope: any) => React.ReactNode;
  /** The read-only rendering, for where the record can't be edited. */
  fallback: React.ReactNode;
}

const BlockEditingRuntimeContext = React.createContext<BlockEditingRuntime | null>(null);

export function BlockEditingRuntimeProvider({
  children,
  runtime,
}: {
  children: React.ReactNode;
  runtime: BlockEditingRuntime | null;
}) {
  return (
    <BlockEditingRuntimeContext.Provider value={runtime}>
      {children}
    </BlockEditingRuntimeContext.Provider>
  );
}

export function useBlockEditingRuntime() {
  return React.useContext(BlockEditingRuntimeContext);
}
