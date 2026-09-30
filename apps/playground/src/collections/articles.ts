import { createCollection, Type } from "camox/createCollection";

export const collection = createCollection({
  id: "articles",
  title: "Articles",
  description: "Editorial articles with independently published records.",
  content: {
    title: Type.String({ minLength: 1 }),
    slug: Type.String({ pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" }),
    excerpt: Type.String(),
    cover: Type.Image(),
    body: Type.String(),
  },
  label: "title",
});
