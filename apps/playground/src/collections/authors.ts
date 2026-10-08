import { createCollection } from "camox/createCollection";

import { collection as articles } from "./articles";

// Authors link the articles they wrote; blocks placing an author reach those articles too.
export const collection = createCollection({
  id: "authors",
  title: "Authors",
  description: "Article authors, each linking the articles they wrote.",
  content: (field) => ({
    name: field.string({ minLength: 1 }),
    bio: field.string(),
    portrait: field.image({ title: "Portrait" }),
    articles: field.referenceList(articles, { title: "Articles", maxItems: 6 }),
  }),
  label: "name",
});
