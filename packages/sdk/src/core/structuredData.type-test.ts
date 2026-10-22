import { createLayout } from "./createLayout";
import type { StructuredDataNode } from "./structuredData";

// Structured data only speaks Camox's vocabulary: a curated list of schema.org types, each with
// the properties `@unhead/schema-org` names, and the ones search engines require that Camox
// can't fill in marked required. Layouts can't emit the site's own types.

const shared = {
  description: "",
  blocks: { before: [], after: [] },
  toReact: () => null,
  toTitle: ({ page }: { page: { title: string } }) => page.title,
  toDescription: () => undefined,
};

/* A layout says its page is a kind of web page, or names a main entity. */

createLayout("about")({
  ...shared,
  title: "About",
  kind: "curated",
  toStructuredData: () => ({ "@type": "AboutPage" }),
});
createLayout("contact")({
  ...shared,
  title: "Contact",
  kind: "curated",
  toStructuredData: ({ page }) => ({ "@type": "ContactPage", keywords: [page.title] }),
});
// Camox fills the headline, description, URL, image, dates, publisher and language.
createLayout("post")({
  ...shared,
  title: "Post",
  kind: "curated",
  toStructuredData: () => ({ "@type": "BlogPosting" }),
});
createLayout("blog.$slug")({
  ...shared,
  title: "Post",
  kind: "derived",
  loader: async ({ params }) => ({ kind: "data", data: { slug: params.slug, words: 812 } }),
  toStructuredData: ({ data, params }) => ({
    "@type": "BlogPosting",
    wordCount: data.words,
    keywords: [params.slug],
    headline: "Set by the layout",
  }),
});
// A layout may declare nothing.
createLayout("maybe")({
  ...shared,
  title: "Maybe",
  kind: "curated",
  toStructuredData: ({ page }) => (page.path === "/" ? undefined : { "@type": "CollectionPage" }),
});

/* Only the curated types. */

createLayout("unknown")({
  ...shared,
  title: "Unknown",
  kind: "curated",
  // @ts-expect-error `Blogpost` isn't a schema.org type.
  toStructuredData: () => ({ "@type": "Blogpost" }),
});
createLayout("unlisted")({
  ...shared,
  title: "Unlisted",
  kind: "curated",
  // @ts-expect-error `Thing` exists in schema.org, but isn't in Camox's vocabulary.
  toStructuredData: () => ({ "@type": "Thing" }),
});
createLayout("invented")({
  ...shared,
  title: "Invented",
  kind: "curated",
  // @ts-expect-error A curated type takes only the properties its node names.
  toStructuredData: () => ({ "@type": "BlogPosting", readingMood: "calm" }),
});

/* Layouts never emit the site's own entities. */

createLayout("organization")({
  ...shared,
  title: "Organization",
  kind: "curated",
  // @ts-expect-error The website's Organization is Camox's, built from the project.
  toStructuredData: () => ({ "@type": "Organization", name: "Acme" }),
});
createLayout("website")({
  ...shared,
  title: "Website",
  kind: "curated",
  // @ts-expect-error The WebSite is Camox's, built from the project.
  toStructuredData: () => ({ "@type": "WebSite", name: "Acme" }),
});

/* What search engines require and Camox can't fill is required. */

createLayout("product")({
  ...shared,
  title: "Product",
  kind: "curated",
  toStructuredData: () => ({ "@type": "Product", offers: { price: 49, priceCurrency: "EUR" } }),
});
createLayout("rated")({
  ...shared,
  title: "Rated",
  kind: "curated",
  toStructuredData: () => ({
    "@type": "Product",
    aggregateRating: { ratingValue: 4.6, reviewCount: 89 },
  }),
});
createLayout("bare-product")({
  ...shared,
  title: "Bare product",
  kind: "curated",
  // @ts-expect-error A Product needs offers, a review or a rating.
  toStructuredData: () => ({ "@type": "Product", sku: "lamp-1" }),
});
createLayout("event")({
  ...shared,
  title: "Event",
  kind: "curated",
  // @ts-expect-error An Event needs its start date and location.
  toStructuredData: () => ({ "@type": "Event", startDate: "2026-11-02" }),
});
createLayout("job")({
  ...shared,
  title: "Job",
  kind: "curated",
  // @ts-expect-error A JobPosting needs its date posted and hiring organization.
  toStructuredData: () => ({ "@type": "JobPosting", title: "Engineer" }),
});

/* Definitions that Camox fills nothing for, such as blocks, need every required property. */

const filledByCamox: StructuredDataNode = { "@type": "BlogPosting", headline: "Hello" };
// @ts-expect-error Without Camox filling it, an Article needs its headline.
const unfilled: StructuredDataNode = { "@type": "BlogPosting" };
// Collections' records can be organizations, unless a definition excludes them.
const customer: StructuredDataNode = { "@type": "Organization", name: "Acme" };
// @ts-expect-error A definition excluding organizations can't emit one.
const excluded: StructuredDataNode<"Organization"> = { "@type": "Organization", name: "Acme" };
// @ts-expect-error The WebSite is never in the vocabulary.
const website: StructuredDataNode = { "@type": "WebSite", name: "Acme" };

export { customer, excluded, filledByCamox, unfilled, website };
