import { createCollection } from "camox/createCollection";

// Articles link their author, so record pages and blocks placing an article reach it too.
export const collection = createCollection({
  id: "authors",
  title: "Authors",
  description: "Article authors, each with a portrait and a short bio.",
  content: (field) => ({
    name: field.string({ minLength: 1 }),
    bio: field.string(),
    portrait: field.image({ title: "Portrait" }),
  }),
  toTitle: ({ content }) => content.name,
  toDescription: ({ content }) => content.bio,
  // Every page placing an author links this one Person, named after the record.
  toStructuredData: ({ content }) => ({ "@type": "Person", image: content.portrait }),
});
