import * as React from "react";

export interface BlockEditingRuntime {
  // Keep the hook prefix so React Compiler never memoizes the context read.
  useSetting(options: object, name: string): unknown;
  renderBlock(options: object, props: object): React.ReactNode;
  renderPrimitive(options: object, primitive: string, props: object): React.ReactNode;
}

const BlockEditingRuntimeContext = React.createContext<BlockEditingRuntime | null>(null);

export function BlockEditingRuntimeProvider({
  children,
  runtime,
}: {
  children: React.ReactNode;
  runtime: BlockEditingRuntime;
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
