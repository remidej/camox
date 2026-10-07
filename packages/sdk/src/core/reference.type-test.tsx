import { createBlock } from "./createBlock";
import { createCollection } from "./createCollection";

const customers = createCollection({
  id: "customers",
  title: "Customers",
  description: "",
  label: "name",
  content: (field) => ({
    name: field.string({ default: "" }),
    logo: field.image(),
    file: field.file({ accept: ["application/pdf"] }),
    video: field.embed({ pattern: ".*", default: "" }),
    enabled: field.boolean({ default: false }),
    category: field.enum({ options: { a: "A" }, default: "a" }),
    images: field.imageList(),
  }),
});
const block = createBlock({
  id: "testimonial",
  title: "Testimonial",
  description: "",
  content: (field) => ({
    customer: field.reference(customers),
    heading: field.string({ default: "" }),
  }),
  component: () => null,
  toMarkdown: (c) => {
    // @ts-expect-error Unknown source field.
    void c.customer.missing;
    return [c.customer.name];
  },
});

function TypeChecks() {
  return (
    <block.Reference name="customer">
      {(customer) => (
        <>
          <customer.Field name="name">{(props) => <h2 {...props} />}</customer.Field>
          <customer.Image name="logo">{(props) => <img {...props} />}</customer.Image>
          <customer.File name="file">{(props) => <a {...props} />}</customer.File>
          <customer.Embed name="video">{(props) => <iframe {...props} />}</customer.Embed>
          <customer.ImageList name="images">{(props) => <img {...props} />}</customer.ImageList>
          {/* @ts-expect-error Image is not inline text. */}
          <customer.Field name="logo">{() => null}</customer.Field>
          {/* @ts-expect-error Enum is not inline text. */}
          <customer.Field name="category">{() => null}</customer.Field>
          {/* @ts-expect-error Unknown collection field. */}
          <customer.Field name="missing">{() => null}</customer.Field>
          {/* @ts-expect-error File is not an image. */}
          <customer.Image name="file">{() => null}</customer.Image>
          {/* @ts-expect-error The scope does not expose nested references. */}
          <customer.Reference name="customer">{() => null}</customer.Reference>
        </>
      )}
    </block.Reference>
  );
}
void TypeChecks;
// @ts-expect-error Only Reference fields can be used as a reference scope.
const invalid = <block.Reference name="heading">{() => null}</block.Reference>;
// @ts-expect-error The UUID selection is not inline text.
const invalidText = <block.Field name="customer">{() => null}</block.Field>;
void [invalid, invalidText];
