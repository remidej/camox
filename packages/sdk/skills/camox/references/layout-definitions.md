# Creating Camox Curated Layout Definitions

A curated layout (`kind: "curated"`, the default) is a reusable shell for editor-created pages, with before/after blocks and page-content `children`. For code-owned singleton pages or derived routes, read [Routed layouts](routed-layouts.md) instead.

All editable content lives in blocks; layouts have no editable `content` schema or `.Field` helpers.

Defining a layout does not assign it to existing Pages. When assignment is requested, wait for dev-server discovery, then follow the [CLI workflow](../SKILL.md#content-and-cli).

## Quick Start

Use one `.tsx` file per layout in `src/layouts/`, a named `layout` or `Layout` export (not default), a named function component, and Tailwind styling.

```tsx
import { createLayout } from "camox/createLayout";
import { block as navbarBlock } from "../blocks/navbar";
import { block as footerBlock } from "../blocks/footer";
import { block as heroBlock } from "../blocks/hero";

const myLayout = createLayout({
  id: "my-layout",
  title: "My Layout",
  description: "Marketing pages with shared navigation and footer.",
  blocks: {
    before: [navbarBlock],
    after: [footerBlock],
    initial: [heroBlock],
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

| Option           | Required | Description                                                                       |
| ---------------- | -------- | --------------------------------------------------------------------------------- |
| `id`             | yes      | Unique kebab-case identifier matching the filename without extension.             |
| `title`          | yes      | CMS display name.                                                                 |
| `description`    | yes      | Guidance for users and agents on which pages suit this layout.                    |
| `blocks`         | yes      | `before`, `after`, and optional `initial` arrays; see placement rules below.      |
| `component`      | yes      | Named function component receiving `{ children }`.                                |
| `buildMetaTitle` | yes      | `({ pageMetaTitle, projectName, pageFullPath }) => string` for the browser title. |
| `buildOgImage`   | no       | `({ title, description, projectName }) => JSX` for a sharing image.               |

## Block Placement — `before`, `after`, and `initial`

- `before` and `after` require blocks with `layoutOnly: true`. Either array may be empty.
- Render groups with `<myLayout.BeforeBlocks />` and `<myLayout.AfterBlocks />`, not individual blocks. Array order controls rendering order; edit the config to add or reorder blocks.
- For identical navbar/footer content across layouts, also set `synced: true`. `layoutOnly` restricts placement; it does not enable syncing. See [Synced blocks](block-definitions.md#synced-blocks-synced-optional) for publishing and existing-instance behavior.

## Initial Blocks — `blocks.initial` (optional)

`initial` seeds the homepage at project creation, using block defaults in array order. It does not populate existing Pages.

- Accepts only blocks with `layoutOnly` omitted or `false`.
- At most one layout per app may define `initial`; multiple definitions cause a startup error.
- Without `initial`, Camox seeds an empty homepage using the first curated layout. Apps with only singleton/derived layouts do not seed a curated homepage.

## OG Image — `buildOgImage` (optional)

Returns JSX rendered as a 1200×630 image. Use **inline styles, not Tailwind**, and `display: "flex"` for layout: this runs in an image-generation engine, not a browser.

```tsx
buildOgImage: ({ title, description, projectName }) => (
  <div
    style={{
      display: "flex",
      flexDirection: "column",
      width: "100%",
      height: "100%",
      padding: 60,
      backgroundColor: "#09090b",
      color: "#fafafa",
      fontFamily: "sans-serif",
    }}
  >
    {projectName && <div style={{ fontSize: 24 }}>{projectName}</div>}
    <div style={{ fontSize: 64 }}>{title}</div>
    {description && <div style={{ fontSize: 28 }}>{description}</div>}
  </div>
),
```
