import { createCollection, Type } from "camox/createCollection";

// Standalone authoring/publication example; no block references this collection.
export const collection = createCollection({
  id: "customers",
  title: "Customers",
  description: "Create and publish customers independently of page content.",
  content: {
    name: Type.String({ minLength: 1 }),
    company: Type.String(),
  },
  label: "name",
});
