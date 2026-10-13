import * as React from "react";

import type { LoadedRecord } from "../requestContext";

export interface BlockEditingRuntime {
  // Keep the hook prefix so React Compiler never memoizes the context read.
  useSetting(options: object, name: string): unknown;
  renderBlock(options: object, props: object): React.ReactNode;
  renderPrimitive(options: object, primitive: string, props: object): React.ReactNode;
  /** Renders a record page's record, editable like a referenced record. */
  renderLayoutItem?(props: LayoutItemProps): React.ReactNode;
}

/** A record page's record, as `layout.Item` hands it to the editing runtime. */
export interface LayoutItemProps {
  collectionId: string;
  /** The collection's label field. */
  labelField: string;
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
