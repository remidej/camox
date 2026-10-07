import { createCollection } from "camox/createCollection";

export const collection = createCollection({
  id: "articles",
  title: "Articles",
  description: "Editorial articles with independently published records.",
  content: (field) => ({
    title: field.string({ minLength: 1 }),
    slug: field.string({ pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" }),
    excerpt: field.string(),
    cover: field.image(),
    body: field.string(),
  }),
  label: "title",
});
