import { createBlock } from "./createBlock";
import { createCollection } from "./createCollection";

const base = { id: "builders", title: "Builders", description: "", component: () => null };

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
          toMarkdown: (c) => [c.text],
        }),
      }),
      settings: (setting) => ({ highlighted: setting.boolean({ default: false }) }),
      minItems: 1,
      maxItems: 2,
      toMarkdown: (c, s) => [s.highlighted(c.nested)],
    }),
  }),
  toMarkdown: (c) => [c.items],
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
  label: "title",
});
