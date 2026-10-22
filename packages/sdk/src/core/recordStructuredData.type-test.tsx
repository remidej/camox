import { createBlock } from "./createBlock";
import { createCollection } from "./createCollection";
import { createLayout } from "./createLayout";

// Collections describe each record as a node of Camox's vocabulary. Unlike blocks, they can
// emit an Organization, for records such as customers, but never the WebSite. References in
// templates and in record pages' layouts link the record's node.

createCollection({
  id: "companies",
  title: "Companies",
  description: "",
  content: (field) => ({ name: field.string(), logo: field.image() }),
  toTitle: ({ content }) => content.name,
  toDescription: () => undefined,
  toStructuredData: ({ content }) => ({ "@type": "Organization", logo: content.logo }),
});

// Camox fills a node's name from the record's title.
const people = createCollection({
  id: "people",
  title: "People",
  description: "",
  content: (field) => ({ name: field.string(), portrait: field.image(), site: field.string() }),
  toTitle: ({ content }) => content.name,
  toDescription: () => undefined,
  toStructuredData: ({ content }) => ({
    "@type": "Person",
    image: content.portrait,
    url: content.site,
  }),
});

// A record's references link other records' nodes.
createCollection({
  id: "books",
  title: "Books",
  description: "",
  content: (field) => ({
    title: field.string(),
    author: field.reference(people),
    illustrator: field.reference(people),
  }),
  toTitle: ({ content }) => content.title,
  toDescription: () => undefined,
  toStructuredData: ({ content }) => ({
    "@type": "Book",
    author: content.author,
    illustrator: content.illustrator,
  }),
});

const name = { title: "", description: "", toTitle: () => "", toDescription: () => undefined };

createCollection({
  ...name,
  id: "sites",
  content: (field) => ({ name: field.string() }),
  // @ts-expect-error Camox alone emits the WebSite.
  toStructuredData: () => ({ "@type": "WebSite", name: "Mine" }),
});

createCollection({
  ...name,
  id: "invented",
  content: (field) => ({ name: field.string() }),
  // @ts-expect-error Types take only the properties of Camox's vocabulary.
  toStructuredData: () => ({ "@type": "Person", favouriteColour: "blue" }),
});

createCollection({
  ...name,
  id: "untyped",
  content: (field) => ({ name: field.string() }),
  // @ts-expect-error `@type` takes only the curated types.
  toStructuredData: () => ({ "@type": "Dragon" }),
});

/* A block's reference links the record's node; its fields still read as the record's values. */

createBlock({
  id: "testimonial",
  title: "Testimonial",
  description: "",
  content: (field) => ({ quote: field.string({ default: "" }), author: field.reference(people) }),
  toReact: () => null,
  toMarkdown: () => [],
  toTitle: ({ content }) => content.quote,
  toStructuredData: ({ content }) => ({
    "@type": "Review",
    reviewBody: content.quote,
    author: content.author,
    name: content.author.name,
  }),
});

/* A record page's layout reads the record's references as links to their nodes. */

const posts = createCollection({
  ...name,
  id: "posts",
  content: (field) => ({
    title: field.string(),
    slug: field.string(),
    author: field.reference(people),
    contributors: field.referenceList(people),
  }),
});

createLayout("posts.$slug")({
  title: "Post",
  description: "",
  kind: "derived",
  blocks: { before: [], after: [] },
  ...posts.pages({ by: "slug", param: "slug" }),
  toReact: () => null,
  toTitle: ({ content }) => content.title,
  toDescription: () => undefined,
  toStructuredData: ({ content }) => ({
    "@type": "BlogPosting",
    author: content.author ? [content.author, ...content.contributors] : content.contributors,
  }),
});
