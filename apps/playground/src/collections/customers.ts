import { createCollection } from "camox/createCollection";

// Testimonials share company names and logos from these independently published customers.
export const collection = createCollection({
  id: "customers",
  title: "Customers",
  description: "Create and publish customers independently of page content.",
  content: (field) => ({
    name: field.string({ minLength: 1 }),
    company: field.string(),
    logo: field.image({ title: "Logo" }),
  }),
  label: "name",
});
