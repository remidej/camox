import { createCollection } from "camox/createCollection";

import { collection as authors } from "./authors";

export const collection = createCollection({
  id: "articles",
  title: "Articles",
  description: "Editorial articles, each with its own record page.",
  content: (field) => ({
    title: field.string({ minLength: 1 }),
    slug: field.string({ pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" }),
    excerpt: field.string(),
    cover: field.image(),
    body: field.string(),
    author: field.reference(authors, { title: "Author" }),
  }),
  label: "title",
});
