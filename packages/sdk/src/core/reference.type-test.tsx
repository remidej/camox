import { createBlock } from "./createBlock";
import { createCollection } from "./createCollection";
import { contentFieldBuilder } from "./lib/contentType";

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
    customers: field.referenceList(customers, { maxItems: 6 }),
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
          {/* @ts-expect-error Customers link no other collection. */}
          <customer.Reference name="name">{() => null}</customer.Reference>
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
void contentFieldBuilder.referenceList(customers, { minItems: 1 });
void [invalidList, invalidListText, invalidSingle, invalidListField, invalidRepeater];

const logoGrid = createBlock({
  id: "logo-grid",
  title: "Logo grid",
  description: "",
  content: (field) => ({
    customers: field.referenceList(customers, {
      toMarkdown: (c) => {
        // @ts-expect-error Unknown collection field.
        void c.missing;
        return [c.name, c.logo];
      },
    }),
  }),
  component: () => null,
  toMarkdown: (c) => {
    // @ts-expect-error The list is included whole, not through one record's fields.
    void c.customers.name;
    return [c.customers];
  },
});
void logoGrid;

const logoWall = createBlock({
  id: "logo-wall",
  title: "Logo wall",
  description: "",
  content: (field) => ({
    logos: field.repeater({
      content: (field) => ({
        customer: field.reference(customers),
        partners: field.referenceList(customers),
        caption: field.string({ default: "" }),
      }),
      settings: (setting) => ({ emphasized: setting.boolean({ default: false }) }),
      minItems: 1,
      maxItems: 6,
      toMarkdown: (c) => {
        // @ts-expect-error Unknown collection field.
        void c.customer.missing;
        return [c.customer.name, c.partners];
      },
    }),
  }),
  component: () => null,
  toMarkdown: (c) => [c.logos],
});

function ItemTypeChecks() {
  return (
    <logoWall.Repeater name="logos">
      {(logo) => (
        <>
          <logo.Reference name="customer">
            {(customer) => (
              <customer.Field name="name">{(props) => <h2 {...props} />}</customer.Field>
            )}
          </logo.Reference>
          <logo.ReferenceList name="partners">
            {(partner) => (
              <partner.Image name="logo">{(props) => <img {...props} />}</partner.Image>
            )}
          </logo.ReferenceList>
          {/* @ts-expect-error Only an item's Reference fields can be a reference scope. */}
          <logo.Reference name="caption">{() => null}</logo.Reference>
          {/* @ts-expect-error A reference list is not a single reference. */}
          <logo.Reference name="partners">{() => null}</logo.Reference>
          {/* @ts-expect-error A single reference is not a list. */}
          <logo.ReferenceList name="customer">{() => null}</logo.ReferenceList>
          {/* @ts-expect-error A reference list is not a nested repeater. */}
          <logo.Repeater name="partners">{() => null}</logo.Repeater>
          {/* @ts-expect-error The UUID selection is not inline text. */}
          <logo.Field name="customer">{() => null}</logo.Field>
        </>
      )}
    </logoWall.Repeater>
  );
}
void ItemTypeChecks;

const authors = createCollection({
  id: "authors",
  title: "Authors",
  description: "",
  label: "name",
  content: (field) => ({
    name: field.string(),
    portrait: field.image(),
    employer: field.reference(customers),
  }),
});
const articles = createCollection({
  id: "articles",
  title: "Articles",
  description: "",
  label: "title",
  content: (field) => ({
    title: field.string(),
    author: field.reference(authors),
    coauthors: field.referenceList(authors),
  }),
});
const teaser = createBlock({
  id: "teaser",
  title: "Teaser",
  description: "",
  content: (field) => ({ article: field.reference(articles) }),
  component: () => null,
  toMarkdown: (c) => {
    // @ts-expect-error Unknown field of the linked record.
    void c.article.author.missing;
    return [c.article.title, c.article.author.name, c.article.coauthors];
  },
});

function NestedTypeChecks() {
  return (
    <teaser.Reference name="article">
      {(article) => (
        <>
          <article.Reference name="author">
            {(author) => (
              <>
                <author.Field name="name">{(props) => <b {...props} />}</author.Field>
                <author.Image name="portrait">{(props) => <img {...props} />}</author.Image>
                {/* @ts-expect-error Records at the second hop link nothing further. */}
                <author.Reference name="employer">{() => null}</author.Reference>
              </>
            )}
          </article.Reference>
          <article.ReferenceList name="coauthors">
            {(author) => <author.Field name="name">{(props) => <i {...props} />}</author.Field>}
          </article.ReferenceList>
          {/* @ts-expect-error A reference list is not a single reference. */}
          <article.Reference name="coauthors">{() => null}</article.Reference>
          {/* @ts-expect-error The title is not a reference. */}
          <article.ReferenceList name="title">{() => null}</article.ReferenceList>
        </>
      )}
    </teaser.Reference>
  );
}
void NestedTypeChecks;

// Query-backed reference lists: code defines membership and order.
const recentArticles = createBlock({
  id: "recent-articles",
  title: "Recent articles",
  description: "",
  content: (field) => ({
    recent: field.referenceList(articles, {
      query: { orderBy: { publishedAt: "desc" }, limit: 3 },
      toMarkdown: (article) => [`## ${article.title}`],
    }),
    alphabetical: field.referenceList(articles, { query: { orderBy: { title: "asc" } } }),
    created: field.referenceList(articles, { query: { orderBy: { createdAt: "asc" } } }),
    all: field.referenceList(articles, { query: {} }),
    capped: field.referenceList(articles, { query: { limit: 100 } }),
    computed: field.referenceList(articles, { query: { limit: Number("3") } }),
    // @ts-expect-error Only text fields and system metadata are orderable.
    byAuthor: field.referenceList(articles, { query: { orderBy: { author: "asc" } } }),
    // @ts-expect-error Unknown ordering key.
    byMissing: field.referenceList(articles, { query: { orderBy: { missing: "asc" } } }),
    // @ts-expect-error Order is "asc" or "desc".
    byUp: field.referenceList(articles, { query: { orderBy: { title: "up" } } }),
    byTwo: field.referenceList(articles, {
      // @ts-expect-error orderBy takes a single key.
      query: { orderBy: { title: "asc", createdAt: "desc" } },
    }),
    // @ts-expect-error Limits above the cap of 100 are rejected.
    overCap: field.referenceList(articles, { query: { limit: 101 } }),
    // @ts-expect-error Limits are positive.
    zero: field.referenceList(articles, { query: { limit: 0 } }),
    // @ts-expect-error There is no where filtering.
    filtered: field.referenceList(articles, { query: { where: { title: "x" } } }),
  }),
  component: () => null,
  toMarkdown: (c) => [c.recent],
});

function QueryTypeChecks() {
  return (
    <recentArticles.ReferenceList name="recent">
      {(article) => (
        <>
          <article.Field name="title">{(props) => <h3 {...props} />}</article.Field>
          <article.Reference name="author">
            {(author) => <author.Field name="name">{(props) => <i {...props} />}</author.Field>}
          </article.Reference>
          {/* @ts-expect-error Unknown collection field. */}
          <article.Field name="missing">{() => null}</article.Field>
        </>
      )}
    </recentArticles.ReferenceList>
  );
}
void QueryTypeChecks;

createCollection({
  id: "reserved",
  title: "Reserved",
  description: "",
  label: "title",
  content: (field) => ({
    title: field.string(),
    // @ts-expect-error Reserved for record metadata in query orderBy.
    publishedAt: field.string(),
  }),
});
createCollection({
  id: "reserved-created",
  title: "Reserved",
  description: "",
  label: "title",
  content: (field) => ({
    title: field.string(),
    // @ts-expect-error Reserved for record metadata in query orderBy.
    createdAt: field.boolean({ default: false }),
  }),
});
createCollection({
  id: "queries",
  title: "Queries",
  description: "",
  label: "title",
  content: (field) => ({
    title: field.string(),
    // @ts-expect-error Collections never hold query-backed lists.
    latest: field.referenceList(articles, { query: {} }),
  }),
});
