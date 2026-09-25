import { createCollection, Type } from "camox/createCollection";

export const collection = createCollection({
  id: "articles",
  title: "Articles",
  description: "Editorial articles with independently published records.",
  content: {
    title: Type.String({ default: "New article", minLength: 1 }),
    slug: Type.String({ default: "new-article", pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" }),
    excerpt: Type.String({ default: "" }),
    cover: Type.Image(),
    body: Type.String({ default: "" }),
  },
  label: "title",
});
