import { Type as TypeBox } from "@sinclair/typebox";

import { createBlock, Type } from "./createBlock";
import type { IconValue } from "./lib/iconTypes";

// Use a branded schema to check field inference independently of a project's
// generated global collection registry.
const icon = TypeBox.Unsafe<IconValue>({
  type: "string",
  fieldType: "Icon",
  default: "lucide:zap",
});
const block = createBlock({
  id: "icon-type-test",
  title: "Icons",
  description: "",
  component: () => null,
  content: {
    icon,
    text: Type.String({ default: "Text" }),
    items: Type.Repeater({
      content: { icon, text: Type.String({ default: "Text" }) },
      minItems: 1,
      maxItems: 5,
      toMarkdown: (c) => [c.text],
    }),
  },
  toMarkdown: (c) => [c.text],
});

function TypeCheck() {
  const valid = <block.Icon name="icon" className="size-6" aria-label="Fast" />;
  // @ts-expect-error Text fields are not icons.
  const invalid = <block.Icon name="text" />;
  // @ts-expect-error Icon fields are not rich text.
  const notText = <block.Field name="icon">{(props) => <span {...props} />}</block.Field>;
  const items = (
    <block.Repeater name="items">
      {(item) => {
        // @ts-expect-error Repeater text fields are not icons.
        const invalidItem = <item.Icon name="text" />;
        return (
          <>
            <item.Icon name="icon" />
            {invalidItem}
          </>
        );
      }}
    </block.Repeater>
  );
  return (
    <>
      {valid}
      {invalid}
      {notText}
      {items}
    </>
  );
}
void TypeCheck;
