import * as React from "react";

import { BlockEditingRuntimeProvider, type BlockEditingRuntime } from "./BlockEditingRuntime";
import { createEditableBlock } from "./createEditableBlock";

const editableDefinitions = new WeakMap<object, ReturnType<typeof createEditableBlock>>();

function getEditableDefinition(options: object) {
  let definition = editableDefinitions.get(options);
  if (definition) return definition;
  definition = createEditableBlock(options as Parameters<typeof createEditableBlock>[0]);
  editableDefinitions.set(options, definition);
  return definition;
}

function EditableBlock({ options, props }: { options: object; props: object }) {
  const definition = getEditableDefinition(options);
  const Component = definition._internal.Component;
  return <Component {...(props as React.ComponentProps<typeof Component>)} />;
}

const completeEditingRuntime: BlockEditingRuntime = {
  useSetting(options, name) {
    return getEditableDefinition(options).useSetting(name);
  },
  renderBlock(options, props) {
    return <EditableBlock options={options} props={props} />;
  },
  renderPrimitive(options, primitive, props) {
    const definition = getEditableDefinition(options) as unknown as Record<
      string,
      React.ComponentType<object>
    >;
    const Primitive = definition[primitive];
    if (!Primitive) throw new Error(`Unknown Camox editing primitive: ${primitive}`);
    return <Primitive {...props} />;
  },
};

export function CompleteBlockEditingRuntimeProvider({ children }: { children: React.ReactNode }) {
  return (
    <BlockEditingRuntimeProvider runtime={completeEditingRuntime}>
      {children}
    </BlockEditingRuntimeProvider>
  );
}
