# Creating Camox Layout Definitions

A layout defines page structure and its before/after blocks. There are three kinds:

- **`curated`** (default): reusable shell for editor-created pages, which choose their URLs and have page-content `children`.
- **`singleton`**: one code-owned page at a fixed file-defined URL. Editors change its blocks, not its existence, URL, or structure.
- **`derived`**: code-owned routes resolved through a required server-side loader, typically using file parameters such as `$name`.

All editable content lives in blocks. Layouts do not expose editable `content` schemas or `.Field` helpers.

## After defining the layout: assign it when requested

For **curated** layouts, a definition only adds a new Layout to the catalog — it doesn't apply it to any Page, and existing Pages keep their current Layout. If the user wanted "the about Page to use the new marketing Layout" or "all docs Pages to use this Layout", follow the umbrella skill's CLI routing to update the relevant Pages after the dev server has picked up the definition. Don't stop after the definition unless the user explicitly requested only a reusable Layout Definition.

## Singleton pages

Declare a singleton in `src/layouts/pokedex.tsx`. The file identity defines `/pokedex`; `guide.pokedex.tsx` defines `/guide/pokedex`. Singleton identities must contain only literal word/hyphen segments separated by dots—no `$params`. The file plugin maintains the identity and registers the definition.

```tsx
import { createLayout } from "camox/createLayout";
import { block as navbarBlock } from "../blocks/navbar";
import { block as pokedexIntroBlock } from "../blocks/pokedex-intro";
import { block as footerBlock } from "../blocks/footer";
import { loadPokemon } from "../lib/pokemon";
import { PokemonBrowser } from "../components/pokemon-browser";

export const Layout = createLayout("pokedex")({
  kind: "singleton",
  title: "Pokédex",
  description: "The code-owned Pokémon directory.",
  blocks: {
    before: [navbarBlock, pokedexIntroBlock],
    after: [footerBlock],
  },
  loader: () => loadPokemon(),
  component: PokedexPage,
  buildMetaTitle: ({ pageMetaTitle }) => pageMetaTitle,
});

function PokedexPage() {
  const pokemon = Layout.useData();
  return (
    <>
      <Layout.BeforeBlocks />
      <main>
        <PokemonBrowser pokemon={pokemon} />
      </main>
      <Layout.AfterBlocks />
    </>
  );
}
```

- `loader` is optional. Its awaited result is inferred by `Layout.useData()`. It runs server-side for document requests and client navigation; return JSON-serializable data. Without a loader, `useData()` returns `undefined`.
- Before/after blocks must be `layoutOnly: true`. Put editable headings, introductions, and other bespoke content in these blocks; keep structural application UI in the component. See [Block Definitions](block-definitions.md).
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

Use the same file-based form with `kind: "derived"`, for example `createLayout("pokemon.$name")`. Its required `loader: ({ params }) => ...` receives typed `params.name`. Read its result through `Layout.useData()`. Use `throw notFound()` (imported from `camox/createLayout`) for a missing record; other loader errors remain server errors. Like singletons, derived routes have before/after blocks but no page-owned `children` or `blocks.initial`. Unlike singletons, curated URLs retain precedence over derived routes.

## Quick Start (curated layouts)

A layout file lives in the app's `src/layouts/` folder, is a `.tsx` file, and exports `layout`:

```tsx
import { createLayout } from "camox/createLayout";
import { block as navbarBlock } from "../blocks/navbar";
import { block as footerBlock } from "../blocks/footer";
import { block as heroBlock } from "../blocks/hero";

const myLayout = createLayout({
  id: "my-layout", // Must match filename (kebab-case)
  title: "My Layout", // Human-readable name
  description: "When to use this layout",
  blocks: {
    before: [navbarBlock], // Blocks rendered before page content
    after: [footerBlock], // Blocks rendered after page content
    initial: [heroBlock], // Blocks to pre-populate on the homepage
  },
  component: MyLayoutComponent,
  buildMetaTitle: ({ pageMetaTitle, projectName }) => `${pageMetaTitle} | ${projectName}`,
});

function MyLayoutComponent({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col">
      <myLayout.BeforeBlocks />
      <div className="flex-1">{children}</div>
      <myLayout.AfterBlocks />
    </main>
  );
}

export { myLayout as layout };
```

## The `createLayout` options

| Option           | Required | Description                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`             | yes      | Unique kebab-case identifier. Must match the filename without extension.                                                                                                                                                                                                                                                                                                                                                          |
| `title`          | yes      | Display name shown in the CMS UI.                                                                                                                                                                                                                                                                                                                                                                                                 |
| `description`    | yes      | Tells the CMS user (or AI agent) when to pick this layout. Write it as guidance — explain what kind of pages this layout suits.                                                                                                                                                                                                                                                                                                   |
| `blocks`         | yes      | An object with `before`, `after`, and optional `initial` arrays. `before` blocks (must be `layoutOnly: true`) render above the page content, `after` blocks (must be `layoutOnly: true`) render below it, and `initial` blocks (must NOT be `layoutOnly: true`) pre-populate the homepage. See [Block Placement](#block-placement--before-after-and-initial) and [Initial Blocks](#initial-blocks--blocksinitial-optional) below. |
| `component`      | yes      | A named React function component that renders the layout shell. Receives `{ children }` — the page content.                                                                                                                                                                                                                                                                                                                       |
| `buildMetaTitle` | yes      | A function that builds the `<title>` tag. Receives `{ pageMetaTitle, projectName, pageFullPath }` and returns a string.                                                                                                                                                                                                                                                                                                           |
| `buildOgImage`   | no       | A function that returns a JSX element for generating Open Graph images. Receives `{ title, description, projectName }`.                                                                                                                                                                                                                                                                                                           |

## Block Placement — `before`, `after`, and `initial`

The `blocks` object groups every block that belongs to this layout into three slots:

- **`before`**: rendered above the page content (navbars, banners, announcements)
- **`after`**: rendered below the page content (footers, cookie bars)
- **`initial`** (optional): pre-populated on the homepage when a project is first created — see the dedicated section below

The blocks in `before` and `after` **must** be marked with `layoutOnly: true` in their block definition — the `createLayout` type rejects non-layout-only blocks in those slots, since layout blocks shouldn't appear in the page-content "add block" picker. Conversely, `initial` accepts only blocks where `layoutOnly` is omitted or `false` — it's for page content, not chrome.

```tsx
blocks: {
  before: [navbarBlock, announcementBlock],
  after: [footerBlock],
}
```

For a navbar or footer whose content must stay identical **across different layouts**, also set `synced: true` in its `createBlock` options. `layoutOnly: true` alone only restricts placement; each layout otherwise has independent data. Synced blocks share content, settings, and repeaters and appear purple in the editor. See [Synced blocks](block-definitions.md#synced-blocks-synced-optional).

You can have multiple blocks in either group, or leave one empty:

```tsx
blocks: {
  before: [navbarBlock],
  after: [],  // No blocks after page content
}
```

## The Layout Component

The component is a named React function that receives `{ children }` and renders the overall page structure. Inside it, use the layout constant's two slot components — `BeforeBlocks` and `AfterBlocks` — to place all of the `before` and `after` blocks, in the order you declared them in the `blocks` config.

```tsx
function MyLayoutComponent({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col">
      <myLayout.BeforeBlocks />
      <div className="flex-1">{children}</div>
      <myLayout.AfterBlocks />
    </main>
  );
}
```

You don't list individual blocks in the component — `<myLayout.BeforeBlocks />` renders every block in `blocks.before` in order, and `<myLayout.AfterBlocks />` does the same for `blocks.after`. To reorder or add blocks, edit the `blocks` config; the component doesn't need to change.

The component controls the HTML structure — you decide how to wrap and position the `BeforeBlocks` / `AfterBlocks` slots and the page content. Use Tailwind CSS for styling.

## Meta Title — `buildMetaTitle`

Controls how the browser tab title is built. Receives three parameters:

- `pageMetaTitle` — the title set on the individual page
- `projectName` — the site/project name
- `pageFullPath` — the full URL path of the page

Common patterns:

```tsx
// "Page Title | Site Name" (most common for content pages)
buildMetaTitle: ({ pageMetaTitle, projectName }) =>
  `${pageMetaTitle} | ${projectName}`,

// "Site Name | Page Title" (common for landing/home pages)
buildMetaTitle: ({ pageMetaTitle, projectName }) =>
  `${projectName} | ${pageMetaTitle}`,

// Just the page title
buildMetaTitle: ({ pageMetaTitle }) => pageMetaTitle,
```

## Initial Blocks — `blocks.initial` (optional)

When a project is first set up, Camox creates a homepage automatically. The `blocks.initial` option lets you specify which blocks (and in what order) should be pre-populated on that page. Each block is created with its default content from the block definition.

```tsx
import { block as heroBlock } from "../blocks/hero";
import { block as statisticsBlock } from "../blocks/statistics";

const myLayout = createLayout({
  // ...
  blocks: {
    before: [navbarBlock],
    after: [footerBlock],
    initial: [heroBlock, statisticsBlock],
  },
});
```

- **Only non-layout blocks.** Blocks here must NOT be `layoutOnly: true` — the type system enforces it. Layout blocks (`before`/`after`) are created separately as part of the layout itself.
- **At most one layout per app can define `blocks.initial`.** If multiple layouts define it, the app will crash with a clear error at startup. This is enforced in `createApp`.
- **Order matters.** The blocks appear on the homepage in the order listed.
- **If no layout defines `blocks.initial`**, Camox creates an empty homepage using the first available **curated** layout. An app with only singleton/derived layouts does not seed a curated homepage.

## OG Image — `buildOgImage` (optional)

Generates an Open Graph image (the preview shown when sharing links on social media). The function returns a JSX element that gets rendered as a 1200x630 image.

The JSX here uses **inline styles only** (no Tailwind) because it's rendered by an image generation engine, not a browser. Use `display: "flex"` for layout.

```tsx
buildOgImage: ({ title, description, projectName }) => (
  <div
    style={{
      display: "flex",
      flexDirection: "column",
      justifyContent: "center",
      alignItems: "flex-start",
      width: "100%",
      height: "100%",
      backgroundColor: "#09090b",
      padding: "60px 80px",
      fontFamily: "sans-serif",
    }}
  >
    {projectName && (
      <div style={{ fontSize: 24, color: "#a1a1aa", marginBottom: 24 }}>
        {projectName}
      </div>
    )}
    <div
      style={{
        fontSize: 64,
        fontWeight: 700,
        color: "#fafafa",
        lineHeight: 1.2,
        marginBottom: 24,
      }}
    >
      {title}
    </div>
    {description && (
      <div style={{ fontSize: 28, color: "#a1a1aa", lineHeight: 1.5 }}>
        {description}
      </div>
    )}
  </div>
),
```

## Rules and Conventions

1. **File = one layout.** One `.tsx` file per layout in `src/layouts/`. The `id` must match the filename (without `.tsx`).
2. **Named export as `layout` or `Layout`.** Use `export { myVar as layout }` or `export const Layout = createLayout("file-id")({...})`. Not a default export.
3. **Named function component.** Use `function MyComponent()`, not an arrow function. Reference it in `createLayout` before its declaration is fine (hoisting).
4. **Import path is `"camox/createLayout"`.** The `createLayout` function comes from this import.
5. **Import blocks from `"../blocks/filename"`.** Layout blocks are imported from the blocks directory. Import the named `block` export.
6. **Use Tailwind CSS for the component.** Style the layout shell with Tailwind utility classes. The OG image function uses inline styles instead.
7. **Render groups, not individual blocks.** The component places `<layout.BeforeBlocks />` and `<layout.AfterBlocks />` — each renders every block in its group, in declared order. Don't reference blocks individually by name.
8. **`buildMetaTitle` is required.** Every layout must define how page titles are constructed.
9. **Description guides layout selection.** Write the `description` to help CMS users choose the right layout for their page — explain what types of pages it's suited for.
10. **Layout blocks must use `layoutOnly: true`.** Blocks placed in `blocks.before` or `blocks.after` must be defined with `layoutOnly: true` (enforced by the `createLayout` type). Blocks placed in `blocks.initial` must NOT be `layoutOnly: true`.
