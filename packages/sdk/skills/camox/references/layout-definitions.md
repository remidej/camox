# Creating Camox Curated Layout Definitions

A curated layout (`kind: "curated"`, the default) is a reusable shell for editor-created pages, with before/after blocks and page-content `children`. For code-owned singleton pages or derived routes, read [Routed layouts](routed-layouts.md) instead.

All editable content lives in blocks; layouts have no editable `content` schema or `.Field` helpers.

Defining a layout does not assign it to existing Pages. When assignment is requested, wait for dev-server discovery, then follow the [CLI workflow](../SKILL.md#content-and-cli).

## Quick Start

Use one `.tsx` file per layout in `src/layouts/`, a named `layout` or `Layout` export (not default), a named function component, and Tailwind styling.

```tsx
import { createLayout } from "camox/createLayout";

import { block as footerBlock } from "../blocks/footer";
import { block as navbarBlock } from "../blocks/navbar";

const myLayout = createLayout({
  id: "my-layout",
  title: "My Layout",
  description: "Marketing pages with shared navigation and footer.",
  blocks: {
    before: [navbarBlock],
    after: [footerBlock],
    initial: [() => import("../blocks/hero")],
  },
  toReact: MyLayoutComponent,
  toTitle: ({ page, project }) => `${page.title} | ${project.name}`,
  toDescription: ({ page }) => page.description,
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

| Option             | Required | Description                                                                                            |
| ------------------ | -------- | ------------------------------------------------------------------------------------------------------ |
| `id`               | yes      | Unique kebab-case identifier matching the filename without extension.                                  |
| `title`            | yes      | CMS display name.                                                                                      |
| `description`      | yes      | Guidance for users and agents on which pages suit this layout.                                         |
| `blocks`           | yes      | `before`, `after`, and optional `initial` arrays; see layout slot rules below.                         |
| `toReact`          | yes      | Named function component receiving the context and `{ children }` as props.                            |
| `toTitle`          | yes      | `(context) => string`: the head title, `og:title`, and the Markdown front matter's `title`.            |
| `toDescription`    | yes      | `(context) => string \| undefined`: the head description and `og:description`. May return `undefined`. |
| `toImage`          | no       | `(context) => JSX`: the sharing image; see below.                                                      |
| `toStructuredData` | no       | `(context) => node \| undefined`: what the page is, in its JSON-LD; see below.                         |

## The `to*` options and their context

Every `to*` option receives the same context object, and none receives another one's output: Camox joins the outputs itself.

- `page.title`: the page's undecorated title. On curated pages, the editor's or generated meta title.
- `page.description`: on curated pages, the editor's or generated description. Absent otherwise.
- `page.path`: the page's path, with its locale's prefix. `page.locale`: the locale's tag, such as `de`.
- `project.name`: the project's name.

Singleton and derived layouts also receive `data` and `params`, and record pages `content`; see [Routed layouts](routed-layouts.md#metadata-and-markdown).

## Layout Slots — `before`, `after`, and `initial`

- `before` and `after` require blocks with `layoutOnly: true`. Either array may be empty.
- Render groups with `<myLayout.BeforeBlocks />` and `<myLayout.AfterBlocks />`, not individual blocks. Array order controls rendering order; edit the config to add or reorder blocks.
- For identical navbar/footer content across layouts, also set `synced: true`. `layoutOnly` restricts a block to layout slots; it does not enable syncing. See [Synced blocks](block-definitions.md#synced-blocks-synced-optional) for sharing and existing-placement behavior.

## Initial Blocks — `blocks.initial` (optional)

`initial` seeds the homepage at project creation, using block defaults in array order. It does not populate existing Pages.

- List each block as an import of its module, `() => import("../blocks/hero")`, never a statically imported block. Layouts load on every page, so a static import would ship the block to every visitor.
- Accepts only blocks with `layoutOnly` omitted or `false`.
- At most one layout per app may define `initial`; multiple definitions cause a startup error.
- Without `initial`, Camox seeds an empty homepage using the first curated layout. Apps with only singleton/derived layouts do not seed a curated homepage.

## OG Image — `toImage` (optional)

Returns JSX rendered as a 1200×630 image. Style it with the Theme's utilities, like a block: the image renders with the site's compiled `src/styles.css` and the Google Fonts that `src/document.ts` loads. It runs in an image engine, not a browser, so:

- Size the root with `h-full w-full`, and lay out with flexbox or grid.
- Put the color scheme class (`dark`, `brand`, …) and `font-body` on the root: the document's `<html>` classes and base styles don't apply.
- Only class, id and descendant selectors match, so `hover:` and other state variants do nothing. Breakpoints see a 1200px-wide viewport.

```tsx
toImage: ({ page, project }) => (
  <div className="dark bg-canvas text-ink font-body flex h-full w-full flex-col justify-center px-20 py-16">
    {project.name && <div className="text-brand mb-6 text-2xl uppercase">{project.name}</div>}
    <div className="font-heading line-clamp-2 text-6xl font-semibold">{page.title}</div>
    {page.description && (
      <div className="text-ink-muted mt-6 line-clamp-2 text-3xl">{page.description}</div>
    )}
  </div>
),
```

The site serves the image at `/og?path=<page path>` for real pages only, rendered from the page as it is published. An editor's custom image replaces it, and a layout without one gets Camox's default image showing the page title and project name.

## Structured Data — `toStructuredData` (optional)

Every page's head carries a JSON-LD graph that Camox builds itself: the project's `Organization` and `WebSite`, and a `WebPage` named and described by `toTitle` and `toDescription`, with its URL, language, image and publish dates. `toStructuredData` only says what the page is. Return one of:

- **A kind of web page**, which the page's node becomes: `AboutPage`, `ContactPage`, `CollectionPage`, `FAQPage`, `ProfilePage`, `ItemPage`, `QAPage`, `SearchResultsPage`, `CheckoutPage`, `MedicalWebPage` or `RealEstateListing`.
- **A main entity**, emitted as its own node and linked as the page's `mainEntity`: an Article type (`BlogPosting`, `NewsArticle`, `TechArticle`, …), `Product`, `Event`, `Person`, `Place`, `Review`, `Question`, `HowTo`, `Recipe`, `Course`, `JobPosting`, `SoftwareApplication`, `VideoObject`, `ImageObject`, `Book`, `Service`, …. Camox fills what you leave out: the name (an Article's `headline`), description, URL and image, plus the dates, publisher and language of creative works. Values you set win. An Article makes `og:type` `article`.

```tsx
toStructuredData: () => ({ "@type": "AboutPage" }),
// A derived layout: the post is the page's main entity.
toStructuredData: ({ data }) => ({ "@type": "BlogPosting", wordCount: data.wordCount }),
toStructuredData: ({ data }) => ({
  "@type": "Product",
  offers: { price: data.price, priceCurrency: "EUR" },
}),
```

- Only the listed types type-check, each with only its schema.org properties. There's no way out to the rest of schema.org.
- Properties search engines require and Camox can't fill are required, such as a `Product`'s `offers`, `review` or `aggregateRating`, an `Event`'s `startDate` and `location`, and a `JobPosting`'s `datePosted` and `hiringOrganization`.
- Layouts can't return `Organization` or `WebSite`: Camox builds the website's own from the project.
