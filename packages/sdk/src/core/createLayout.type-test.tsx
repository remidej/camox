import { createCollection } from "./createCollection";
import {
  createLayout,
  type LayoutCollectionItemResult,
  type LayoutRequestContext,
} from "./createLayout";

const Definition = createLayout("pokemon.$name")({
  kind: "derived",
  title: "Pokemon",
  description: "",
  blocks: { before: [], after: [] },
  // Metadata callbacks and toMarkdown follow the loader, which their data is inferred from.
  loader: async ({ params }) => {
    const name: string = params.name;
    // @ts-expect-error Only parameters named by the file identity exist.
    void params.slug;
    return { kind: "data", data: { name, count: 1 } };
  },
  buildMetaTitle: ({ data, params, pageMetaTitle }) => {
    const count: number = data.count;
    const name: string = params.name;
    return `${name} (${count}) – ${pageMetaTitle}`;
  },
  buildMetaDescription: ({ data, pageMetaDescription }) => pageMetaDescription ?? data.name,
  toMarkdown: ({ data, params }) => [`# ${data.name}`, `/${params.name}`],
  component: () => null,
});

function DataTypeCheck() {
  const data = Definition.useData();
  const count: number = data.count;
  // @ts-expect-error Awaited loader data is not any.
  const invalid: string = data.count;
  return (
    <span>
      {count}
      {invalid}
    </span>
  );
}
void DataTypeCheck;

const singletonOptions = {
  title: "Pokédex",
  description: "",
  blocks: { before: [], after: [] },
  buildMetaTitle: ({ pageMetaTitle }: { pageMetaTitle: string }) => pageMetaTitle,
  component: () => null,
};
const Singleton = createLayout("pokedex")({
  ...singletonOptions,
  kind: "singleton",
  loader: async () => ({ kind: "data", data: { count: 12 } }),
});
const StaticSingleton = createLayout("about")({ ...singletonOptions, kind: "singleton" });
function SingletonTypeCheck() {
  const count: number = Singleton.useData().count;
  // @ts-expect-error Singleton loader result is inferred, not any.
  const invalid: string = Singleton.useData().count;
  const empty: undefined = StaticSingleton.useData();
  return (
    <span>
      {count}
      {invalid}
      {empty}
    </span>
  );
}
void SingletonTypeCheck;
// @ts-expect-error Singletons cannot seed curated page content.
createLayout("invalid")({
  ...singletonOptions,
  kind: "singleton",
  blocks: { before: [], after: [], initial: [] },
});

const syncLayout = createLayout("sync")({
  ...singletonOptions,
  kind: "singleton",
  loader: () => ({ kind: "data", data: { nested: [1, 2], nullable: null } }),
});
const legacyLayout = createLayout({
  ...singletonOptions,
  id: "legacy",
  kind: "singleton",
  loader: async () => ({ kind: "data", data: "legacy data" }),
});
const curatedLayout = createLayout("curated")({ ...singletonOptions, kind: "curated" });
const loadCount = async () => ({ kind: "data" as const, data: { count: 12 } });
const wrappedLoader = async () => await loadCount();
const wrappedLayout = createLayout("wrapped")({
  ...singletonOptions,
  kind: "singleton",
  loader: wrappedLoader,
});

function MoreDataTypeChecks() {
  const numbers: number[] = syncLayout.useData().nested;
  const nullable: null = syncLayout.useData().nullable;
  const legacy: string = legacyLayout.useData();
  const empty: undefined = curatedLayout.useData();
  const wrapped: number = wrappedLayout.useData().count;
  // @ts-expect-error useData returns only the payload, not the envelope.
  void Definition.useData().kind;
  // @ts-expect-error Ordinary data does not expose a collection item scope.
  void Definition.Item;
  return [numbers, nullable, legacy, empty, wrapped];
}
void MoreDataTypeChecks;

createLayout("old-result")({
  ...singletonOptions,
  kind: "singleton",
  // @ts-expect-error Bare loader data is no longer accepted.
  loader: async () => ({ count: 12 }),
});
createLayout("missing-data")({
  ...singletonOptions,
  kind: "singleton",
  // @ts-expect-error Every successful loader result must contain data.
  loader: () => ({ kind: "data" }),
});
createLayout("incomplete-record")({
  ...singletonOptions,
  kind: "singleton",
  // @ts-expect-error A collection-item envelope names its record.
  loader: () => ({ kind: "collection-item", collectionId: "articles", data: {} }),
});

// Record pages: `pages()` spreads a loader and routes into a derived layout.
const articles = createCollection({
  id: "articles",
  title: "Articles",
  description: "",
  content: (field) => ({ title: field.string(), slug: field.string(), cover: field.image() }),
  label: "title",
});
const ArticlePage = createLayout("articles.$slug")({
  ...singletonOptions,
  kind: "derived",
  ...articles.pages({ by: "slug", param: "slug" }),
  buildMetaTitle: ({ data }) => data.content.title,
  toMarkdown: ({ data }) => [`# ${data.content.title}`],
});
function RecordDataTypeCheck() {
  const { id, content } = ArticlePage.useData();
  const title: string = content.title;
  // @ts-expect-error useData returns the record, not the envelope.
  void ArticlePage.useData().collectionId;
  // @ts-expect-error Record content is typed by the collection.
  void content.missing;
  return [id, title];
}
void RecordDataTypeCheck;

// Record layouts render their record through `layout.Item`, and get it as `item` in
// `toMarkdown` and meta callbacks.
const authors = createCollection({
  id: "authors",
  title: "Authors",
  description: "",
  content: (field) => ({ name: field.string(), portrait: field.image() }),
  label: "name",
});
const posts = createCollection({
  id: "posts",
  title: "Posts",
  description: "",
  content: (field) => ({
    title: field.string(),
    slug: field.string(),
    cover: field.image(),
    author: field.reference(authors),
  }),
  label: "title",
});
const postPages = posts.pages({ by: "slug", param: "slug" });
const PostPage = createLayout("posts.$slug")({
  ...singletonOptions,
  kind: "derived",
  ...postPages,
  buildMetaTitle: ({ item, data }) => `${item.title} (${data.id})`,
  buildMetaDescription: ({ item }) => {
    // @ts-expect-error Meta callbacks get the record's String fields only.
    void item.cover;
    return item.slug;
  },
  toMarkdown: ({ item }) => [`# ${item.title}`, `By ${item.author.name}`, item.cover],
});
function ItemTypeCheck() {
  return (
    <PostPage.Item>
      {(post) => (
        <article aria-label={post.label}>
          <post.Field name="title">{(props) => <h1 {...props} />}</post.Field>
          {/* @ts-expect-error Field renders String fields only. */}
          <post.Field name="cover">{(props) => <h1 {...props} />}</post.Field>
          <post.Image name="cover">{(props) => <img {...props} />}</post.Image>
          {/* @ts-expect-error Field names belong to the collection. */}
          <post.Field name="missing">{(props) => <h1 {...props} />}</post.Field>
          <post.Reference name="author">
            {(author) => {
              // @ts-expect-error The second hop links nothing further.
              void author.Reference;
              return <author.Field name="name">{(props) => <p {...props} />}</author.Field>;
            }}
          </post.Reference>
        </article>
      )}
    </PostPage.Item>
  );
}
void ItemTypeCheck;
// A wrapper typed as the helper's loader keeps the typed `Item`.
const WrappedPostPage = createLayout("posts.$slug")({
  ...singletonOptions,
  kind: "derived",
  loader: async (input): ReturnType<typeof postPages.loader> => postPages.loader(input),
});
void WrappedPostPage.Item;
const MixedPage = createLayout("posts.$slug")({
  ...singletonOptions,
  kind: "derived",
  loader: async (input) =>
    input.params.slug === "external"
      ? { kind: "data" as const, data: { title: "External" } }
      : postPages.loader(input),
  // @ts-expect-error Only record layouts get `item`.
  toMarkdown: ({ item }) => [String(item)],
});
// @ts-expect-error A loader that may return external data has no record scope.
void MixedPage.Item;
const articleSlugPages = articles.pages({ by: "slug", param: "slug" });
const TwoCollectionsPage = createLayout("posts.$slug")({
  ...singletonOptions,
  kind: "derived",
  loader: async (input) =>
    input.params.slug.startsWith("a-") ? articleSlugPages.loader(input) : postPages.loader(input),
});
// @ts-expect-error A loader returning records of two collections has no record scope.
void TwoCollectionsPage.Item;

// @ts-expect-error Pages are found by a String field only.
articles.pages({ by: "cover", param: "slug" });
// @ts-expect-error Pages are found by a field of the collection.
articles.pages({ by: "missing", param: "slug" });
// @ts-expect-error The param must be one of the route's params.
createLayout("pokemon.$name")({
  ...singletonOptions,
  kind: "derived",
  ...articles.pages({ by: "slug", param: "slug" }),
});
// A wrapper passes the context through and returns the exported envelope unchanged.
const articlePages = articles.pages({ by: "slug", param: "slug" });
const WrappedArticlePage = createLayout("articles.$slug")({
  ...singletonOptions,
  kind: "derived",
  loader: async (input): Promise<LayoutCollectionItemResult<{ title: string }>> => {
    const result = await articlePages.loader(input);
    return result;
  },
  routes: articlePages.routes,
});
const wrappedTitle: string = WrappedArticlePage.useData().content.title;
void wrappedTitle;
// @ts-expect-error An envelope typed without its collection's fields has no record scope.
void WrappedArticlePage.Item;
createLayout("undefined-result")({
  ...singletonOptions,
  kind: "singleton",
  // @ts-expect-error Omit the loader rather than returning no envelope.
  loader: () => undefined,
});

const derivedOptions = {
  ...singletonOptions,
  kind: "derived" as const,
  loader: async () => ({ kind: "data" as const, data: null }),
};
createLayout("articles.$slug")({
  ...derivedOptions,
  routes: async () => ({ data: [{ params: { slug: "introducing-collections" } }] }),
});
// A collection-backed entry names its record.
createLayout("articles.$slug")({
  ...derivedOptions,
  routes: () => ({
    data: [
      {
        params: { slug: "introducing-collections" },
        target: { kind: "collection-item" as const, collectionId: "articles", id: "article-1" },
      },
    ],
  }),
});
createLayout("articles.$slug")({
  ...derivedOptions,
  // @ts-expect-error A target names a collection record.
  routes: () => ({ data: [{ params: { slug: "a" }, target: { kind: "page", id: "1" } }] }),
});
createLayout("articles.$slug")({
  ...derivedOptions,
  // @ts-expect-error Discovered params are named by the route.
  routes: () => ({ data: [{ params: { name: "introducing-collections" } }] }),
});
createLayout("articles.$slug")({
  ...derivedOptions,
  // @ts-expect-error Every route param needs a value.
  routes: () => ({ data: [{ params: {} }] }),
});
// Loader and routes receive the request context, which wrappers pass through unchanged.
declare function readWithContext(context: LayoutRequestContext): Promise<string[]>;
createLayout("articles.$slug")({
  ...singletonOptions,
  kind: "derived",
  loader: async ({ params, context }) => {
    const [title = params.slug] = await readWithContext(context);
    return { kind: "data", data: { title } };
  },
  routes: async ({ context }) => ({
    data: (await readWithContext(context)).map((slug) => ({ params: { slug } })),
  }),
});
createLayout("articles.$slug")({
  ...singletonOptions,
  kind: "derived",
  // @ts-expect-error The request context is opaque, not a source to read.
  loader: async ({ context }) => ({ kind: "data", data: context.source }),
});
// @ts-expect-error The request context is opaque: only Camox creates it.
void readWithContext({});
// @ts-expect-error Only derived layouts discover routes.
createLayout("pokedex")({ ...singletonOptions, kind: "singleton", routes: () => ({ data: [] }) });
// @ts-expect-error Only derived layouts discover routes.
createLayout("curated")({ ...singletonOptions, kind: "curated", routes: () => ({ data: [] }) });

createLayout("pokemon.$name")({
  ...derivedOptions,
  // @ts-expect-error Layout Markdown is a list of strings.
  toMarkdown: () => "# Pokemon",
});
// @ts-expect-error Curated pages render editor content, not layout Markdown.
createLayout("curated")({ ...singletonOptions, kind: "curated", toMarkdown: () => [] });
createLayout("curated")({
  ...singletonOptions,
  kind: "curated",
  // Curated pages have no loader data.
  buildMetaTitle: ({ data, pageMetaTitle }) => (data satisfies undefined) ?? pageMetaTitle,
});
