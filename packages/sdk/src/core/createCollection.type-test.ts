import { createApp } from "./createApp";
import { createCollection, type Collection } from "./createCollection";
import { collectionFieldBuilder } from "./lib/contentType";

const content = {
  title: collectionFieldBuilder.string({ default: "" }),
  subtitle: collectionFieldBuilder.string({ default: "" }),
  image: collectionFieldBuilder.image(),
  enabled: collectionFieldBuilder.boolean({ default: false }),
  category: collectionFieldBuilder.enum({ options: { one: "One" }, default: "one" }),
  embed: collectionFieldBuilder.embed({ pattern: ".*", default: "" }),
};
const options = { id: "articles", title: "Articles", description: "", content: () => content };
const collection = createCollection({
  ...options,
  toTitle: ({ content }) => `${content.title}: ${content.subtitle}`,
  toDescription: ({ content }) => content.subtitle,
});
createApp({ blocks: [], collections: [collection] });
// A description may return nothing.
createCollection({
  ...options,
  toTitle: ({ content }) => content.title,
  toDescription: () => undefined,
});

const typedCollection: Collection<typeof content> = collection;
const titleSchema: typeof content.title = typedCollection._internal.contentSchema.properties.title;
void titleSchema;

// @ts-expect-error Titles and descriptions are required.
createCollection(options);
// @ts-expect-error Descriptions are required, even when they return nothing.
createCollection({ ...options, toTitle: ({ content }) => content.title });
createCollection({
  ...options,
  // @ts-expect-error Titles name a record: they return text.
  toTitle: () => undefined,
  toDescription: () => undefined,
});
createCollection({
  ...options,
  // @ts-expect-error Unknown field.
  toTitle: ({ content }) => content.missing,
  toDescription: () => undefined,
});
createCollection({
  ...options,
  // @ts-expect-error Assets are not text.
  toTitle: ({ content }) => content.image,
  toDescription: () => undefined,
});
createCollection({
  ...options,
  toTitle: ({ content }) => content.title,
  // @ts-expect-error Booleans are not text.
  toDescription: ({ content }) => content.enabled,
});
createCollection({
  ...options,
  // @ts-expect-error Enum is not a text field.
  toTitle: ({ content }) => content.category,
  toDescription: () => undefined,
});
createCollection({
  ...options,
  // @ts-expect-error Embed is not a text field.
  toTitle: ({ content }) => content.embed,
  toDescription: () => undefined,
});
collection.pages({ by: "title", param: "slug" });
// @ts-expect-error Record pages need a lookup field and a route param.
collection.pages();
// @ts-expect-error Record pages are found by a String field only.
collection.pages({ by: "category", param: "slug" });

createCollection({
  id: "posts",
  title: "Posts",
  description: "",
  content: (field) => ({
    title: field.string(),
    article: field.reference(collection),
    articles: field.referenceList(collection),
    // @ts-expect-error Collection references are never required.
    required: field.reference(collection, { required: true }),
  }),
  toTitle: ({ content }) => content.title,
  toDescription: () => undefined,
});

createCollection({
  id: "brochures",
  title: "Brochures",
  description: "",
  content: (field) => ({
    title: field.string(),
    // @ts-expect-error Collection images are never required.
    cover: field.image({ required: true }),
    // @ts-expect-error Collection files are never required.
    brochure: field.file({ accept: ["application/pdf"], required: true }),
  }),
  toTitle: ({ content }) => content.title,
  toDescription: () => undefined,
});

createCollection({
  id: "reviews",
  title: "Reviews",
  description: "",
  content: (field) => ({ quote: field.string(), article: field.reference(collection) }),
  // @ts-expect-error Templates read the record's own String fields, not a referenced record's.
  toTitle: ({ content }) => content.article.title,
  toDescription: () => undefined,
});
