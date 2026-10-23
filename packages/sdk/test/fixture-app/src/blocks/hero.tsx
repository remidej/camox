import { createBlock } from "camox/createBlock";

export const block = createBlock({
  id: "hero",
  title: "Hero",
  description: "A title",
  content: (field) => ({ title: field.string({ default: "Welcome" }) }),
  toReact: () => <block.Field name="title">{(props) => <h1 {...props} />}</block.Field>,
  toTitle: ({ content }) => content.title,
  toMarkdown: ({ content }) => [content.title],
});
