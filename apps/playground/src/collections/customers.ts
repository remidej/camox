import { createCollection } from "camox/createCollection";

// Testimonials share company names and logos from these customers.
export const collection = createCollection({
  id: "customers",
  title: "Customers",
  description: "Customers whose names and logos testimonials share.",
  content: (field) => ({
    name: field.string({ minLength: 1 }),
    company: field.string(),
    logo: field.image({ title: "Logo" }),
  }),
  label: "name",
});
