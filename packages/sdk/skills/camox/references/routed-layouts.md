# Singleton pages and derived routes

Use this reference for code-owned pages in `src/layouts/`. For editor-created pages with a reusable shell and page-content `children`, read [Layout Definitions](layout-definitions.md) instead.

- **`singleton`**: one code-owned page at a fixed file-defined URL. Editors change its blocks, not its existence, URL, or structure.
- **`derived`**: code-owned routes resolved through a required server-side loader, typically using file parameters such as `$name`.

All editable content lives in blocks. Layouts do not expose editable `content` schemas or `.Field` helpers; [record pages](#record-pages) render their collection record through `layout.Item`. Read [Block Definitions](block-definitions.md) when creating or changing those blocks.

## Singleton pages

Declare a singleton in `src/layouts/pokedex.tsx`. The file identity defines `/pokedex`; `guide.pokedex.tsx` defines `/guide/pokedex`. Singleton identities must contain only literal word/hyphen segments separated by dots—no `$params`. The file plugin maintains the identity and registers the definition.

```tsx
import { createLayout } from "camox/createLayout";

import { block as footerBlock } from "../blocks/footer";
import { block as navbarBlock } from "../blocks/navbar";
import { block as pokedexIntroBlock } from "../blocks/pokedex-intro";
import { PokemonBrowser } from "../components/pokemon-browser";
import { loadPokemon } from "../lib/pokemon";

export const layout = createLayout("pokedex")({
  kind: "singleton",
  title: "Pokédex",
  description: "The code-owned Pokémon directory.",
  blocks: {
    before: [navbarBlock, pokedexIntroBlock],
    after: [footerBlock],
  },
  loader: async () => ({ kind: "data", data: await loadPokemon() }),
  // After the loader: these callbacks' `data` is inferred from it.
  buildMetaTitle: ({ pageMetaTitle }) => pageMetaTitle,
  toMarkdown: ({ data }) => [`${data.length} Pokémon`, data.map((p) => `- ${p.name}`).join("\n")],
  component: PokedexPage,
});

function PokedexPage() {
  const pokemon = layout.useData();
  return (
    <>
      <layout.BeforeBlocks />
      <main>
        <PokemonBrowser pokemon={pokemon} />
      </main>
      <layout.AfterBlocks />
    </>
  );
}
```

- `loader` is optional. Return `{ kind: "data", data }`, synchronously or asynchronously. `layout.useData()` infers and returns the unwrapped `data`, not the envelope. It runs server-side for document requests and client navigation; the entire envelope travels through JSON to hydration. Keep data JSON-serializable (no functions, symbols, BigInt, or cyclic objects). Without a loader, `useData()` returns `undefined`. The loader also receives `locale`, the page's locale tag; Camox renders its data untranslated (see [Localization](localization.md#loaders)).
- Before/after blocks must be `layoutOnly: true`. Put editable headings, introductions, and other bespoke content in these blocks; keep structural application UI in the component. See [Block Definitions](block-definitions.md).
- For a navbar or footer whose content must stay identical across different layouts, also set `synced: true` in its `createBlock` options. `layoutOnly: true` alone only restricts placement. See [Synced blocks](block-definitions.md#synced-blocks-synced-optional) for sharing behavior.
- No `children` slot or `blocks.initial`: editors do not compose or create these pages.
- No curated page record is created. Do not use the pages CLI to create, duplicate, move, or assign a singleton.
- Studio lists singletons as directly navigable pages with block editing, without deletion or URL/layout controls. They also appear in link destination pickers (including inline text links), “Go to page” actions, and the runtime sitemap. Derived pages appear in the sitemap only when their layout declares `routes` (see [Route discovery](#route-discovery)).
- Singleton links are saved as fixed internal URLs, not synthetic database page IDs: link fields use `{ type: "external", href: "/pokedex", text: "Pokédex", newTab: false }` (the existing URL representation), while inline text uses `[Pokédex](/pokedex)`. Renaming a code-owned URL requires updating links or adding a redirect. Curated-page links retain their page-ID references.
- Curated-only mutation surfaces, such as page-parent selectors and the pages record API/CLI, remain separate from the navigable destination list.
- The route renders the current editable blocks.
- Code deployment controls route existence. Removing the definition and syncing releases its reserved URL. Existing curated URL collisions or layouts still assigned to curated pages must be resolved explicitly before sync can succeed.
- Curated pages cannot claim singleton URLs or use singleton/derived layouts. Literal singleton routes take precedence over parameterized derived routes.
- See [Metadata and Markdown](#metadata-and-markdown) for page titles, descriptions, and the page's Markdown Representation.

## Derived routes

Use the same file-based form with `kind: "derived"`, for example `createLayout("pokemon.$name")`. Its required `loader: ({ params }) => ...` receives typed `params.name` and returns `{ kind: "data", data }`. Read its unwrapped data through `layout.useData()`. Use `throw notFound()` (imported from `camox/createLayout`) for a missing record; other loader errors remain server errors. Like singletons, derived routes have before/after blocks but no page-owned `children` or `blocks.initial`. Unlike singletons, curated URLs retain precedence over derived routes.

### Route discovery

A derived layout can list the pages it renders with an optional `routes` function, a sibling of `loader`:

```tsx
export const Layout = createLayout("pokemon.$name")({
  kind: "derived",
  // Other options omitted.
  loader: async ({ params }) => ({ kind: "data", data: await loadPokemon(params.name) }),
  routes: async () => ({
    data: (await listPokemon()).map((pokemon) => ({ params: { name: pokemon.name } })),
  }),
});
```

- Return `{ data: [{ params }] }`, synchronously or asynchronously. `params` is typed from the file identity: `pokemon.$name` needs exactly `{ name: string }`. Return raw values; Camox builds and encodes the URL (`mr mime` becomes `/pokemon/mr%20mime`).
- Only derived layouts accept `routes`; singletons and curated layouts are a type error.
- The runtime sitemap lists every discovered page, without `<lastmod>`. The Canvas previews the layout's first discovered page until a path is chosen.
- Entries may carry an optional `target` naming the collection record they render (see [Record pages](#record-pages)).
- An invalid entry (missing, extra or empty params, or a value containing `/`) or a throwing `routes` makes `/sitemap.xml` respond 500 with a message naming the layout, rather than silently omitting pages.
- `routes` lists pages; it does not authorize them. The loader still validates every request, and URLs left out of `routes` keep rendering. A curated page at a discovered URL still takes precedence and may be listed twice.
- `routes` returns every page at once.
- `loader` receives `{ params, context }` and `routes` receives `{ context }`. `context` is an opaque request context: ignore it, or pass it through unchanged to Camox helpers. The sitemap and Markdown always get live content; HTML and Studio navigation follow the editor's session.

### Record pages

A **Record Page** renders one collection record, found by one of its fields. Spread `collection.pages({ by, param })` into a derived layout instead of writing `loader` and `routes`:

```tsx
import { createLayout } from "camox/createLayout";

import { collection as articles } from "../collections/articles";

export const Layout = createLayout("articles.$slug")({
  kind: "derived",
  title: "Article",
  description: "One article, found by its slug.",
  blocks: { before: [navbarBlock], after: [footerBlock] },
  ...articles.pages({ by: "slug", param: "slug" }),
  buildMetaTitle: ({ item, projectName }) => `${item.title} | ${projectName}`,
  buildMetaDescription: ({ item }) => item.excerpt || undefined,
  toMarkdown: ({ item }) => [`# ${item.title}`, `By ${item.author.name}`, item.body],
  component: ArticlePage,
});

function ArticlePage() {
  return (
    <Layout.Item>
      {(article) => (
        <article>
          <article.Field name="title">{(props) => <h1 {...props} />}</article.Field>
          <article.Reference name="author">
            {(author) => <author.Field name="name">{(props) => <p {...props} />}</author.Field>}
          </article.Reference>
          <article.Field name="body">{(props) => <p {...props} />}</article.Field>
        </article>
      )}
    </Layout.Item>
  );
}
```

- `by` names a String field of the collection; any other field is a type error. `param` names the route parameter holding its value; a layout whose route lacks it fails to type-check.
- The loader finds the record whose `by` field's plain text equals the param: the draft value for a signed-in editor previewing, the published value for everyone else. A draft-only record is reachable in preview at its draft value; a never-published or unknown value answers 404. Records whose value is empty or contains `/` never get a page.
- Several records sharing a value in the same source is a server error naming the collection, field, value and records. Camox does not enforce uniqueness: keep the field unique.
- The loader returns a `collection-item` envelope, `{ kind: "collection-item", collectionId, data: { id, content } }`, typed as `LayoutCollectionItemResult` from `camox/createLayout`. `layout.useData()` returns the unwrapped record, `{ id, content }`. Camox rejects an envelope naming an unregistered collection or a malformed record id.
- `routes` lists one entry per record that can have a page, in the request's source: the sitemap lists published records only, even when an editor asks, while the Canvas previews a signed-in editor's first record, draft-only records included. Each entry is `{ params, target: { kind: "collection-item", collectionId, id } }`; `target` names the record independently of its current value. Records whose value is empty or contains `/` are left out. Several records sharing a value fail discovery, so `/sitemap.xml` responds 500 naming the layout and the records. An empty collection returns `{ data: [] }`, and the Canvas asks for a path.
- `layout.Item` renders the page's record with the same typed scope as a block's `Reference`: `Field`, `Image`, `File`, `Embed`, `ImageList`, `FileList`, `Reference` and `ReferenceList`, plus `id` and `label`. Field names are checked against the collection. The record is the first hop: `Reference` and `ReferenceList` render the records it links, which link nothing further. Prefer it to `useData()`, whose `content` holds stored values (String fields may be rich-text state).
- `layout.Item` exists only when every return of the loader is a record of one collection. On a loader that may return external data or records of several collections, using it is a type error. At runtime it renders nothing when the result isn't a record.
- In Studio, editors edit record page fields in place, like a referenced record's: purple overlays, selection, and the record's fields in the sidebar. Edits change the shared record everywhere it appears.
- `toMarkdown` also receives `item`, the same Markdown builder as a reference list's `toMarkdown`: interpolate fields (`item.title`, `item.author.name`, `item.cover`) and Camox fills them with the live record, rich text included. `data` stays the raw record. Markdown always shows live content, whoever asks.
- `buildMetaTitle` and `buildMetaDescription` also receive `item`: the record's String fields as plain text.
- To wrap the helper, pass the whole loader input through, `context` included, and return the envelope unchanged. Type it as the helper's loader (`ReturnType<typeof articlePages.loader>`) to keep `layout.Item` and `item` typed:

```tsx
const articlePages = articles.pages({ by: "slug", param: "slug" });
// …
loader: async (input) => {
  const result = await articlePages.loader(input);
  return result;
},
routes: articlePages.routes,
```

## Migrating existing loaders

This is a breaking loader contract: replace `return pokemon` with `return { kind: "data", data: pokemon }`. For asynchronous data, await the payload inside the envelope: `return { kind: "data", data: await loadPokemon() }`, not a promise in `data`. Components using `layout.useData()` do not change. Existing layouts without loaders do not change.

For an explicit return annotation, import `type LayoutLoaderResult` from `camox/createLayout` and use `Promise<LayoutLoaderResult<Pokemon>>` instead of `Promise<Pokemon>`. Inline loaders infer their payload automatically. Standalone loader functions can use `LayoutLoaderResult<Pokemon>` (or `satisfies LayoutLoaderResult<Pokemon>`) to keep `kind` a literal rather than a widened string. Wrappers are ordinary functions returning the same envelope; no attached properties or discovery phase are involved.

The playground's `/pokedex`, `/pokemon/pikachu`, and `/pokemon-types/electric` are working external-data examples, and both derived layouts declare `routes`, so `/sitemap.xml` lists every Pokémon and type. Load a URL directly, follow a Pokémon/type link, and refresh: `useData()` receives the same payload in server rendering, navigation, and hydration. Search and “Show more” still run on client state. A nonexistent Pokémon still returns 404; a PokéAPI failure is still a server error.

`kind: "data"` does not make external data editable. For collection records, use [Record pages](#record-pages).

## Metadata and Markdown

Singleton and derived pages get the same head as curated pages: title, description, `og:*` tags, the `/og` image, and the favicon. They have no editor metadata, so the callbacks receive the loader's unwrapped `data` and the route `params` instead:

```tsx
export const Layout = createLayout("pokemon.$name")({
  kind: "derived",
  // Other options omitted.
  loader: async ({ params }) => ({ kind: "data", data: await loadPokemon(params.name) }),
  buildMetaTitle: ({ data, pageMetaTitle }) => `${data.name} – ${pageMetaTitle}`,
  buildMetaDescription: ({ data }) => `${data.name} is a ${data.types.join("/")} type Pokémon.`,
  toMarkdown: ({ data, params }) => [`# ${data.name}`, `Types: ${data.types.join(", ")}`],
});
```

- **Put `loader` before `buildMetaTitle`, `buildMetaDescription`, and `toMarkdown`.** TypeScript infers their `data` from the loader only in that order. Otherwise the loader is inferred as `never` and fails to type-check.
- `buildMetaTitle` receives `pageMetaTitle` (the layout's `title` on these pages), `projectName`, `pageFullPath`, `data`, and `params`. The `/og` image shows its result.
- `buildMetaDescription` is optional; without it these pages have no description.
- `toMarkdown` returns the page's Markdown Representation as a list of strings. Empty strings are dropped and the rest joined with blank lines. A request with `Accept: text/markdown` gets YAML front matter (the `title` and `description` the head shows, and the page's `url`), then the live before-block Markdown, then this output, then the live after-block Markdown. Curated pages' Markdown opens with the same front matter. Without `toMarkdown`, the page answers HTML only. `throw notFound()` in the loader answers 404. Curated layouts cannot declare `toMarkdown`: their Markdown comes from their blocks.
- The playground's Pokémon, Pokémon type, and Pokédex layouts declare these. Try `curl -H "Accept: text/markdown" http://localhost:3000/pokemon/pikachu`.

## File and component conventions

- One `.tsx` file per layout in `src/layouts/`; the identity passed to `createLayout("file-id")` must match the filename without `.tsx`.
- Use a named `Layout` or `layout` export, not a default export.
- Use a named function component and Tailwind CSS for the layout shell.
- Render `<Layout.BeforeBlocks />` and `<Layout.AfterBlocks />` to place the configured groups in order, rather than rendering individual blocks by name.
