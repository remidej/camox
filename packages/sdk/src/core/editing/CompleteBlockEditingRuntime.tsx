import * as React from "react";

import {
  BlockEditingRuntimeProvider,
  type BlockEditingRuntime,
  type BlockOptions,
  type EditingPrimitive,
} from "./BlockEditingRuntime";
import {
  createEditableBlock,
  type BlockComponentProps,
  type EditableBlock as EditableDefinition,
} from "./createEditableBlock";

const editableDefinitions = new WeakMap<BlockOptions, EditableDefinition>();

function getEditableDefinition(options: BlockOptions) {
  let definition = editableDefinitions.get(options);
  if (definition) return definition;
  definition = createEditableBlock(options);
  editableDefinitions.set(options, definition);
  return definition;
}

/** A primitive of the editable definition, rendered with the props the view block received. */
function editingPrimitive(
  definition: EditableDefinition,
  primitive: EditingPrimitive,
): ((props: any) => React.ReactNode) | undefined {
  return definition[primitive];
}

function EditableBlock({
  options,
  props,
}: {
  options: BlockOptions;
  props: BlockComponentProps<Record<string, unknown>>;
}) {
  const definition = getEditableDefinition(options);
  const Component = definition._internal.Component;
  return <Component {...props} />;
}

/** Record pages' records render through the record scope of a block without fields. */
const layoutItemOptions = {
  id: "camox-layout-item",
  title: "",
  description: "",
  content: () => ({}),
  toMarkdown: () => [],
  toReact: () => null,
  toTitle: () => "",
};

const completeEditingRuntime: BlockEditingRuntime = {
  renderLayoutItem(props) {
    const { LayoutItem } = getEditableDefinition(layoutItemOptions)._internal;
    return <LayoutItem {...props} />;
  },
  useSetting(options, name) {
    return getEditableDefinition(options).useSetting(name);
  },
  renderBlock(options, props) {
    return <EditableBlock options={options} props={props} />;
  },
  renderPrimitive(options, primitive, props) {
    const Primitive = editingPrimitive(getEditableDefinition(options), primitive);
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
