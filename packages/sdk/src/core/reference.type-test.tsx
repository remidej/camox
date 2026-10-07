import { createBlock, Type } from "./createBlock";
import { createCollection } from "./createCollection";

const customers = createCollection({
  id: "customers",
  title: "Customers",
  description: "",
  label: "name",
  content: {
    name: Type.String({ default: "" }),
    logo: Type.Image(),
    file: Type.File({ accept: ["application/pdf"] }),
    video: Type.Embed({ pattern: ".*", default: "" }),
    enabled: Type.Boolean({ default: false }),
    category: Type.Enum({ options: { a: "A" }, default: "a" }),
    images: Type.ImageList(),
  },
});
const block = createBlock({
  id: "testimonial",
  title: "Testimonial",
  description: "",
  content: {
    customer: Type.Reference(customers),
    customers: Type.ReferenceList(customers, { maxItems: 6 }),
    heading: Type.String({ default: "" }),
  },
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

function ListTypeChecks() {
  return (
    <block.ReferenceList name="customers">
      {(customer) => (
        <li key={customer.id} aria-label={customer.label}>
          <customer.Field name="name">{(props) => <h2 {...props} />}</customer.Field>
          <customer.Image name="logo">{(props) => <img {...props} />}</customer.Image>
          <customer.File name="file">{(props) => <a {...props} />}</customer.File>
          <customer.Embed name="video">{(props) => <iframe {...props} />}</customer.Embed>
          <customer.ImageList name="images">{(props) => <img {...props} />}</customer.ImageList>
          {/* @ts-expect-error Image is not inline text. */}
          <customer.Field name="logo">{() => null}</customer.Field>
          {/* @ts-expect-error Unknown collection field. */}
          <customer.Field name="missing">{() => null}</customer.Field>
          {/* @ts-expect-error File is not an image. */}
          <customer.Image name="file">{() => null}</customer.Image>
        </li>
      )}
    </block.ReferenceList>
  );
}
void ListTypeChecks;
// @ts-expect-error Only ReferenceList fields can be listed.
const invalidList = <block.ReferenceList name="customer">{() => null}</block.ReferenceList>;
// @ts-expect-error Text fields are not reference lists.
const invalidListText = <block.ReferenceList name="heading">{() => null}</block.ReferenceList>;
// @ts-expect-error A reference list is not a single reference.
const invalidSingle = <block.Reference name="customers">{() => null}</block.Reference>;
// @ts-expect-error The id list is not inline text.
const invalidListField = <block.Field name="customers">{() => null}</block.Field>;
// @ts-expect-error A reference list is not a repeater.
const invalidRepeater = <block.Repeater name="customers">{() => null}</block.Repeater>;
// @ts-expect-error There is no minItems or required for reference lists.
void Type.ReferenceList(customers, { minItems: 1 });
void [invalidList, invalidListText, invalidSingle, invalidListField, invalidRepeater];
