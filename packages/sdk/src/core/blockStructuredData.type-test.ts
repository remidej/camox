import { Type as TypeBox } from "@sinclair/typebox";

import { createBlock } from "./createBlock";
import type { IconValue } from "./lib/iconTypes";

// Blocks and repeatable items describe what they show in Camox's vocabulary. Their templates read
// text, image, file, link and embed fields, and place a repeater's items' nodes by its token.
// Icons and artifacts aren't Structured Data, and only Camox emits the site's Organization.

const icon = TypeBox.Unsafe<IconValue>({
  type: "string",
  fieldType: "Icon",
  default: "lucide:zap",
});

const base = {
  title: "Showcase",
  description: "",
  toReact: () => null,
  toMarkdown: () => [],
  toTitle: () => "Showcase",
};

const content = (field: Parameters<Parameters<typeof createBlock>[0]["content"]>[0]) => ({
  name: field.string({ default: "Laptop" }),
  photo: field.image(),
  manual: field.file({ accept: ["application/pdf"] }),
  link: field.link({ default: { text: "Buy", href: "/buy", newTab: false } }),
  video: field.embed({ pattern: "^https://", default: "https://youtube.com/embed/x" }),
  icon,
  visual: field.artifact({ size: "fill" }),
  questions: field.repeater({
    content: (item) => ({
      question: item.string({ default: "Why?" }),
      answer: item.string({ default: "Because" }),
      icon,
    }),
    minItems: 1,
    maxItems: 10,
    toMarkdown: ({ content }) => [content.question],
    toTitle: ({ content }) => content.question,
    toStructuredData: ({ content }) => ({
      "@type": "Question",
      name: content.question,
      acceptedAnswer: { "@type": "Answer", text: content.answer },
    }),
  }),
});

/* Field tokens take their places in nodes, and a repeater's token places its items' nodes. */

createBlock({
  ...base,
  id: "showcase",
  content,
  toStructuredData: ({ content }) => [
    {
      "@type": "Product",
      name: content.name,
      image: content.photo,
      url: content.link,
      offers: { "@type": "Offer", price: 49, priceCurrency: "EUR" },
    },
    {
      "@type": "Book",
      name: content.name,
      author: { "@type": "Person", name: "Ada" },
      url: content.manual,
    },
    content.questions,
  ],
});
createBlock({ ...base, id: "faq", content, toStructuredData: ({ content }) => content.questions });
createBlock({
  ...base,
  id: "video",
  content,
  toStructuredData: ({ content }) => ({
    "@type": "VideoObject",
    name: content.name,
    embedUrl: content.video,
    thumbnailUrl: "https://acme.test/thumbnail.png",
    uploadDate: "2026-01-01",
  }),
});

/* Icons and artifacts aren't Structured Data. */

createBlock({
  ...base,
  id: "icon",
  content,
  // @ts-expect-error An icon field has no token in Structured Data.
  toStructuredData: ({ content }) => ({ "@type": "Person", name: "Ada", image: content.icon }),
});
createBlock({
  ...base,
  id: "artifact",
  content,
  // @ts-expect-error An artifact field has no token in Structured Data.
  toStructuredData: ({ content }) => ({ "@type": "Person", name: content.visual }),
});
createBlock({
  ...base,
  id: "item-icon",
  content: (field) => ({
    items: field.repeater({
      content: (item) => ({ name: item.string({ default: "Ada" }), icon }),
      minItems: 1,
      maxItems: 3,
      toMarkdown: () => [],
      toTitle: () => "Item",
      // @ts-expect-error An item's icon field has no token in Structured Data either.
      toStructuredData: ({ content }) => ({ "@type": "Person", name: content.icon }),
    }),
  }),
});

/* An image is an ImageObject, not text. */

createBlock({
  ...base,
  id: "image-as-text",
  content,
  // @ts-expect-error A name is text.
  toStructuredData: ({ content }) => ({ "@type": "Person", name: content.photo }),
});

/* Only Camox emits the site's Organization and WebSite. */

createBlock({
  ...base,
  id: "organization",
  content,
  // @ts-expect-error Blocks can't describe an Organization.
  toStructuredData: ({ content }) => ({ "@type": "Organization", name: content.name }),
});
createBlock({
  ...base,
  id: "website",
  content,
  // @ts-expect-error WebSite isn't in Camox's vocabulary.
  toStructuredData: ({ content }) => ({ "@type": "WebSite", name: content.name }),
});
createBlock({
  ...base,
  id: "item-organization",
  content: (field) => ({
    items: field.repeater({
      content: (item) => ({ name: item.string({ default: "Acme" }) }),
      minItems: 1,
      maxItems: 3,
      toMarkdown: () => [],
      toTitle: () => "Item",
      // @ts-expect-error Repeatable items can't describe an Organization either.
      toStructuredData: ({ content }) => ({ "@type": "Organization", name: content.name }),
    }),
  }),
});

/* Nodes take only their types' properties, and need what search engines require. */

createBlock({
  ...base,
  id: "invented",
  content,
  // @ts-expect-error Products have no `mood`.
  toStructuredData: ({ content }) => [
    {
      "@type": "Product",
      name: content.name,
      offers: { "@type": "Offer", price: 49, priceCurrency: "EUR" },
      mood: 1,
    },
  ],
});
createBlock({
  ...base,
  id: "no-offers",
  content,
  // @ts-expect-error A product needs offers, a review or a rating.
  toStructuredData: ({ content }) => ({ "@type": "Product", name: content.name }),
});
