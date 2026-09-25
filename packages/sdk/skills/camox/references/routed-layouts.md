# Singleton pages and derived routes

Use this reference for code-owned pages in `src/layouts/`. For editor-created pages with a reusable shell and page-content `children`, read [Layout Definitions](layout-definitions.md) instead.

- **`singleton`**: one code-owned page at a fixed file-defined URL. Editors change its blocks, not its existence, URL, or structure.
- **`derived`**: code-owned routes resolved through a required server-side loader, typically using file parameters such as `$name`.

All editable content lives in blocks. Layouts do not expose editable `content` schemas or `.Field` helpers. Read [Block Definitions](block-definitions.md) when creating or changing those blocks.

## Singleton pages

Declare a singleton in `src/layouts/pokedex.tsx`. The file identity defines `/pokedex`; `guide.pokedex.tsx` defines `/guide/pokedex`. Singleton identities must contain only literal word/hyphen segments separated by dots—no `$params`. The file plugin maintains the identity and registers the definition.

```tsx
import { createLayout } from "camox/createLayout";
import { block as navbarBlock } from "../blocks/navbar";
import { block as pokedexIntroBlock } from "../blocks/pokedex-intro";
import { block as footerBlock } from "../blocks/footer";
import { loadPokemon } from "../lib/pokemon";
import { PokemonBrowser } from "../components/pokemon-browser";

export const layout = createLayout("pokedex")({
  kind: "singleton",
  title: "Pokédex",
  description: "The code-owned Pokémon directory.",
  blocks: {
    before: [navbarBlock, pokedexIntroBlock],
    after: [footerBlock],
  },
  loader: async () => ({ kind: "data", data: await loadPokemon() }),
  component: PokedexPage,
  buildMetaTitle: ({ pageMetaTitle }) => pageMetaTitle,
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

- `loader` is optional. Return `{ kind: "data", data }`, synchronously or asynchronously. `layout.useData()` infers and returns the unwrapped `data`, not the envelope. It runs server-side for document requests and client navigation; the entire envelope travels through JSON to hydration. Keep data JSON-serializable (no functions, symbols, BigInt, or cyclic objects). Without a loader, `useData()` returns `undefined`.
- Before/after blocks must be `layoutOnly: true`. Put editable headings, introductions, and other bespoke content in these blocks; keep structural application UI in the component. See [Block Definitions](block-definitions.md).
- For a navbar or footer whose content must stay identical across different layouts, also set `synced: true` in its `createBlock` options. `layoutOnly: true` alone only restricts placement. See [Synced blocks](block-definitions.md#synced-blocks-synced-optional) for sharing and publishing behavior.
- No `children` slot or `blocks.initial`: editors do not compose or create these pages.
- No curated page record is created. Do not use the pages CLI to create, duplicate, move, or assign a singleton.
- Studio lists singletons as directly navigable pages with block editing and layout publishing, without deletion or URL/layout controls. They also appear in link destination pickers (including inline text links), “Go to page” actions, and the runtime sitemap. Derived route families are not enumerated.
- Singleton links are saved as fixed internal URLs, not synthetic database page IDs: link fields use `{ type: "external", href: "/pokedex", text: "Pokédex", newTab: false }` (the existing URL representation), while inline text uses `[Pokédex](/pokedex)`. Renaming a code-owned URL requires updating links or adding a redirect. Curated-page links retain their page-ID references.
- Curated-only mutation surfaces, such as page-parent selectors and the pages record API/CLI, remain separate from the navigable destination list.
- Publishing exposes the current editable blocks. Unpublishing removes those published blocks, **not** the route or code-rendered UI. Synced blocks retain their existing shared publishing behavior.
- Code deployment controls route existence. Removing the definition and syncing releases its reserved URL. Existing curated URL collisions or layouts still assigned to curated pages must be resolved explicitly before sync can succeed.
- Curated pages cannot claim singleton URLs or use singleton/derived layouts. Literal singleton routes take precedence over parameterized derived routes.
- Current routed-page HTML titles use the definition's `title`; the required `buildMetaTitle` option is retained for API compatibility, but routed-page metadata callbacks are not yet applied.

## Derived routes

Use the same file-based form with `kind: "derived"`, for example `createLayout("pokemon.$name")`. Its required `loader: ({ params }) => ...` receives typed `params.name` and returns `{ kind: "data", data }`. Read its unwrapped data through `layout.useData()`. Use `throw notFound()` (imported from `camox/createLayout`) for a missing record; other loader errors remain server errors. Like singletons, derived routes have before/after blocks but no page-owned `children` or `blocks.initial`. Unlike singletons, curated URLs retain precedence over derived routes.

## Migrating existing loaders

This is a breaking loader contract: replace `return pokemon` with `return { kind: "data", data: pokemon }`. For asynchronous data, await the payload inside the envelope: `return { kind: "data", data: await loadPokemon() }`, not a promise in `data`. Components using `layout.useData()` do not change. Existing layouts without loaders do not change.

For an explicit return annotation, import `type LayoutLoaderResult` from `camox/createLayout` and use `Promise<LayoutLoaderResult<Pokemon>>` instead of `Promise<Pokemon>`. Inline loaders infer their payload automatically. Standalone loader functions can use `LayoutLoaderResult<Pokemon>` (or `satisfies LayoutLoaderResult<Pokemon>`) to keep `kind` a literal rather than a widened string. Wrappers are ordinary functions returning the same envelope; no attached properties or discovery phase are involved.

The playground's `/pokedex`, `/pokemon/pikachu`, and `/pokemon-types/electric` are working external-data examples. Load a URL directly, follow a Pokémon/type link, and refresh: `useData()` receives the same payload in server rendering, navigation, and hydration. Search and “Show more” still run on client state. A nonexistent Pokémon still returns 404; a PokéAPI failure is still a server error.

Only `kind: "data"` is supported here. It does not make external data editable. Collection-item results, collection APIs, route discovery, and layout Markdown are separate future capabilities.

## File and component conventions

- One `.tsx` file per layout in `src/layouts/`; the identity passed to `createLayout("file-id")` must match the filename without `.tsx`.
- Use a named `Layout` or `layout` export, not a default export.
- Use a named function component and Tailwind CSS for the layout shell.
- Render `<Layout.BeforeBlocks />` and `<Layout.AfterBlocks />` to place the configured groups in order, rather than rendering individual blocks by name.
