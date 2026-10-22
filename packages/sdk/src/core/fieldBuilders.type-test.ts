import { createBlock } from "./createBlock";
import { createCollection } from "./createCollection";

const base = { id: "builders", title: "Builders", description: "", toReact: () => null };

createBlock({
  ...base,
  content: (field) => ({
    title: field.string({ default: "" }),
    // @ts-expect-error Enums are settings, not block content.
    variant: field.enum({ default: "a", options: { a: "A" } }),
    // @ts-expect-error Booleans are settings, not block content.
    visible: field.boolean({ default: true }),
  }),
  toMarkdown: () => [],
  toTitle: () => "Block",
});

createBlock({
  ...base,
  content: (field) => ({ title: field.string({ default: "" }) }),
  settings: (setting) => ({
    variant: setting.enum({ default: "a", options: { a: "A", b: "B" } }),
    // @ts-expect-error Settings are only enums and booleans.
    label: setting.string({ default: "" }),
  }),
  toMarkdown: () => [],
  toTitle: () => "Block",
});

createBlock({
  ...base,
  content: (field) => ({
    items: field.repeater({
      content: (field) => ({
        // @ts-expect-error Repeatable item content follows block content rules.
        visible: field.boolean({ default: true }),
        nested: field.repeater({
          content: (field) => ({ text: field.string({ default: "" }) }),
          minItems: 1,
          maxItems: 2,
          toMarkdown: ({ content }) => [content.text],
          toTitle: () => "Item",
        }),
      }),
      settings: (setting) => ({ highlighted: setting.boolean({ default: false }) }),
      minItems: 1,
      maxItems: 2,
      toMarkdown: ({ content, settings }) => [settings.highlighted(content.nested)],
      toTitle: () => "Item",
    }),
  }),
  toMarkdown: ({ content }) => [content.items],
  toTitle: () => "Block",
});

// Collections have no settings, so enums and booleans are record content.
createCollection({
  id: "articles",
  title: "Articles",
  description: "",
  content: (field) => ({
    title: field.string(),
    featured: field.boolean({ default: false }),
    kind: field.enum({ default: "news", options: { news: "News" } }),
    // @ts-expect-error Collections cannot store repeaters yet.
    items: field.repeater,
  }),
  toTitle: ({ content }) => content.title,
  toDescription: () => undefined,
});
