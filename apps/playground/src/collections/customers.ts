import { createCollection, Type } from "camox/createCollection";

// Testimonials share company names and logos from these independently published customers.
export const collection = createCollection({
  id: "customers",
  title: "Customers",
  description: "Create and publish customers independently of page content.",
  content: {
    name: Type.String({ minLength: 1 }),
    company: Type.String(),
    logo: Type.Image({ title: "Logo" }),
  },
  label: "name",
});
