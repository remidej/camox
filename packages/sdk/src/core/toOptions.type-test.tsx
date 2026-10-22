import { createBlock } from "./createBlock";
import { createCollection } from "./createCollection";
import { createLayout } from "./createLayout";

// Every `to*` option receives one context. Each name means the same thing everywhere and is
// absent where it doesn't apply: `page` and `project` on layouts, `data` and `params` on
// singleton and derived layouts, `content` on record pages, blocks and repeatable items, and
// `settings` on blocks and repeatable items.

const shared = { description: "", blocks: { before: [], after: [] } };

/* Curated layouts: page and project. */

createLayout("curated")({
  ...shared,
  title: "Curated",
  kind: "curated",
  toReact: ({ page, project, children }) => (
    <main title={`${page.title} ${page.path} ${page.locale} ${project.name}`}>{children}</main>
  ),
  toTitle: ({ page, project }) => `${page.title} | ${project.name}`,
  toDescription: ({ page }) => {
    const description: string | undefined = page.description;
    return description;
  },
  toImage: ({ page, project }) => <div>{`${page.title} ${project.name}`}</div>,
});
createLayout("curated")({
  ...shared,
  title: "Curated",
  kind: "curated",
  toReact: ({ children }) => children,
  // @ts-expect-error Curated pages have no loader data.
  toTitle: ({ data }) => String(data),
});
createLayout("curated")({
  ...shared,
  title: "Curated",
  kind: "curated",
  toReact: ({ children }) => children,
  // @ts-expect-error Curated pages have no params.
  toTitle: ({ params }) => String(params),
});
createLayout("curated")({
  ...shared,
  title: "Curated",
  kind: "curated",
  toReact: ({ children }) => children,
  // @ts-expect-error Curated pages render no record.
  toTitle: ({ content }) => String(content),
});
createLayout("curated")({
  ...shared,
  title: "Curated",
  kind: "curated",
  toReact: ({ children }) => children,
  toTitle: ({ page }) => page.title,
  // @ts-expect-error Curated pages have no loader data, in `toImage` too.
  toImage: ({ data }) => <div>{String(data)}</div>,
});
createLayout("curated")({
  ...shared,
  title: "Curated",
  kind: "curated",
  toReact: ({ children }) => children,
  // @ts-expect-error No `to*` option receives another's output.
  toDescription: ({ title }) => title,
  toTitle: ({ page }) => page.title,
});

/* Singleton and derived layouts: data and params too. */

createLayout("pokedex")({
  ...shared,
  title: "Pokédex",
  kind: "singleton",
  loader: async () => ({ kind: "data", data: { count: 12 } }),
  toReact: ({ page, data }) => <p>{`${page.title} ${data.count}`}</p>,
  toTitle: ({ data, params, page }) => {
    const count: number = data.count;
    const none: Record<string, never> = params;
    return `${page.title} (${count}) ${Object.keys(none).length}`;
  },
});
createLayout("pokedex")({
  ...shared,
  title: "Pokédex",
  kind: "singleton",
  toReact: () => null,
  // @ts-expect-error Singletons without records have no content.
  toTitle: ({ content }) => String(content),
});
createLayout("pokemon.$name")({
  ...shared,
  title: "Pokemon",
  kind: "derived",
  loader: async ({ params }) => ({ kind: "data", data: { name: params.name } }),
  toReact: ({ params, data }) => <p>{`${params.name} ${data.name}`}</p>,
  toTitle: ({ data, params }) => `${data.name} ${params.name}`,
  toDescription: ({ data }) => data.name,
  toImage: ({ data, params, page }) => <div>{`${data.name} ${params.name} ${page.title}`}</div>,
});
createLayout("pokemon.$name")({
  ...shared,
  title: "Pokemon",
  kind: "derived",
  loader: async ({ params }) => ({ kind: "data", data: { name: params.name } }),
  toReact: () => null,
  // @ts-expect-error Only parameters named by the file identity exist.
  toTitle: ({ params }) => params.slug,
});

/* Record pages: the record's values as content. */

const authors = createCollection({
  id: "authors",
  title: "Authors",
  description: "",
  content: (field) => ({ name: field.string() }),
  toTitle: ({ content }) => content.name,
  toDescription: () => undefined,
});
const articles = createCollection({
  id: "articles",
  title: "Articles",
  description: "",
  content: (field) => ({
    title: field.string(),
    slug: field.string(),
    author: field.reference(authors),
  }),
  toTitle: ({ content }) => content.title,
  toDescription: () => undefined,
});

createLayout("articles.$slug")({
  ...shared,
  title: "Article",
  kind: "derived",
  ...articles.pages({ by: "slug", param: "slug" }),
  toReact: ({ content, page }) => <h1>{`${content.title} ${page.title}`}</h1>,
  toTitle: ({ content, params }) => `${content.title} ${params.slug}`,
  toDescription: ({ content, data }) => `${content.slug} ${data.id}`,
  toImage: ({ content, project }) => <div>{`${content.title} ${project.name}`}</div>,
});
createLayout("articles.$slug")({
  ...shared,
  title: "Article",
  kind: "derived",
  ...articles.pages({ by: "slug", param: "slug" }),
  toReact: () => null,
  // @ts-expect-error Content holds the record's String fields as text.
  toTitle: ({ content }) => content.author,
});

/* Old and new names never go together, and a layout needs a title. */

// @ts-expect-error `component` is `toReact`'s old name.
createLayout("curated")({
  ...shared,
  title: "Curated",
  kind: "curated",
  component: ({ children }: { children: React.ReactNode }) => children,
  toReact: ({ children }: { children: React.ReactNode }) => children,
  toTitle: ({ page }) => page.title,
});
// @ts-expect-error `buildMetaTitle` is `toTitle`'s old name.
createLayout("curated")({
  ...shared,
  title: "Curated",
  kind: "curated",
  toReact: ({ children }: { children: React.ReactNode }) => children,
  toTitle: () => "",
  buildMetaTitle: () => "",
});
// @ts-expect-error `buildMetaDescription` is `toDescription`'s old name.
createLayout("curated")({
  ...shared,
  title: "Curated",
  kind: "curated",
  toReact: ({ children }: { children: React.ReactNode }) => children,
  toTitle: () => "",
  toDescription: () => "",
  buildMetaDescription: () => "",
});
// @ts-expect-error `buildOgImage` is `toImage`'s old name.
createLayout("curated")({
  ...shared,
  title: "Curated",
  kind: "curated",
  toReact: ({ children }: { children: React.ReactNode }) => children,
  toTitle: () => "",
  toImage: () => <div />,
  buildOgImage: () => <div />,
});
// @ts-expect-error Every layout has a title, under either name.
createLayout("curated")({
  ...shared,
  title: "Curated",
  kind: "curated",
  toReact: ({ children }: { children: React.ReactNode }) => children,
});
// The old names still work, beside new ones they don't rename.
createLayout("curated")({
  ...shared,
  title: "Curated",
  kind: "curated",
  component: ({ children }) => children,
  buildMetaTitle: ({ pageMetaTitle }) => pageMetaTitle,
  toDescription: ({ page }) => page.description,
});

/* Blocks and repeatable items: content and settings. */

const blockFields = {
  id: "hero",
  title: "Hero",
  description: "",
  content: (field: Parameters<Parameters<typeof createBlock>[0]["content"]>[0]) => ({
    title: field.string({ default: "Hi" }),
  }),
};

createBlock({
  ...blockFields,
  settings: (setting) => ({ dark: setting.boolean({ default: false }) }),
  toReact: ({ content, settings }) => <h1>{`${content.title} ${settings.dark}`}</h1>,
  toMarkdown: ({ content, settings }) => [`# ${content.title}`, settings.dark(content.title)],
});
createBlock({
  ...blockFields,
  toReact: () => null,
  // @ts-expect-error Blocks have no page.
  toMarkdown: ({ page }) => [String(page)],
});
createBlock({
  ...blockFields,
  // @ts-expect-error Blocks have no page.
  toReact: ({ page }: { page: string }) => <p>{page}</p>,
  toMarkdown: () => [],
});
createBlock({
  ...blockFields,
  content: (field) => ({
    items: field.repeater({
      content: (item) => ({ name: item.string({ default: "Item" }) }),
      settings: (setting) => ({ featured: setting.boolean({ default: false }) }),
      minItems: 1,
      maxItems: 3,
      toMarkdown: ({ content, settings }) => [settings.featured(content.name)],
    }),
  }),
  toReact: () => null,
  toMarkdown: ({ content }) => [content.items],
});
createBlock({
  ...blockFields,
  content: (field) => ({
    items: field.repeater({
      content: (item) => ({ name: item.string({ default: "Item" }) }),
      minItems: 1,
      maxItems: 3,
      // @ts-expect-error Repeatable items have no page.
      toMarkdown: ({ page }) => [String(page)],
    }),
  }),
  toReact: () => null,
  toMarkdown: () => [],
});
// @ts-expect-error `component` is `toReact`'s old name.
createBlock({
  ...blockFields,
  component: () => null,
  toReact: () => null,
  toMarkdown: () => [],
});
// The old names still work.
createBlock({
  ...blockFields,
  component: ({ content }) => <h1>{content.title}</h1>,
  toMarkdown: (c) => [`# ${c.title}`],
});
