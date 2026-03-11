---
name: camox-layout
description: "How to create and edit Camox layout definition files. Use this skill whenever the user wants to create a new layout for their Camox website, modify an existing layout, wrap pages in shared structure (navbar + footer), customize meta titles or OG images, or asks about the layout definition API. Trigger on mentions of layouts, page wrappers, page templates, shared page structure, navbar/footer placement, or any request to define how pages are structured — even if they don't say 'layout' explicitly."
---

# Creating Camox Layout Definitions

A layout wraps pages in shared structure — a navbar at the top, a footer at the bottom, consistent styling. Each page in the CMS is assigned a layout. This skill covers creating layout **definitions** — the template that describes which blocks surround page content and how to render them.

## Quick Start

A layout file lives in the app's `src/camox/layouts/` folder, is a `.tsx` file, and exports `layout`:

```tsx
import { createLayout } from "camox/createLayout";
import { block as navbarBlock } from "../blocks/navbar";
import { block as footerBlock } from "../blocks/footer";

const myLayout = createLayout({
  id: "my-layout",              // Must match filename (kebab-case)
  title: "My Layout",           // Human-readable name
  description: "When to use this layout",
  blocks: {
    before: [navbarBlock],      // Blocks rendered before page content
    after: [footerBlock],       // Blocks rendered after page content
  },
  component: MyLayoutComponent,
  buildMetaTitle: ({ pageMetaTitle, projectName }) =>
    `${pageMetaTitle} | ${projectName}`,
});

function MyLayoutComponent({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col">
      <myLayout.blocks.Navbar />
      <div className="flex-1">{children}</div>
      <myLayout.blocks.Footer />
    </main>
  );
}

export { myLayout as layout };
```

## The `createLayout` options

| Option | Required | Description |
|---|---|---|
| `id` | yes | Unique kebab-case identifier. Must match the filename without extension. |
| `title` | yes | Display name shown in the CMS UI. |
| `description` | yes | Tells the CMS user (or AI agent) when to pick this layout. Write it as guidance — explain what kind of pages this layout suits. |
| `blocks` | yes | An object with `before` and `after` arrays. Each array contains block instances (imported from block files). `before` blocks render above the page content, `after` blocks render below it. |
| `component` | yes | A named React function component that renders the layout shell. Receives `{ children }` — the page content. |
| `buildMetaTitle` | yes | A function that builds the `<title>` tag. Receives `{ pageMetaTitle, projectName, pageFullPath }` and returns a string. |
| `buildOgImage` | no | A function that returns a JSX element for generating Open Graph images. Receives `{ title, description, projectName }`. |

## Block Placement — `before` and `after`

Layout blocks are split into two groups:

- **`before`**: rendered above the page content (navbars, banners, announcements)
- **`after`**: rendered below the page content (footers, cookie bars)

The blocks you reference here are regular block definitions (created with `createBlock`). They're typically marked with `layoutOnly: true` in their block definition so they don't appear in the "add block" picker for page content.

```tsx
blocks: {
  before: [navbarBlock, announcementBlock],
  after: [footerBlock],
}
```

You can have multiple blocks in either group, or leave one empty:

```tsx
blocks: {
  before: [navbarBlock],
  after: [],  // No blocks after page content
}
```

## The Layout Component

The component is a named React function that receives `{ children }` and renders the overall page structure. Inside it, use the slot components from the layout constant to place each block.

Slot components are accessed via `layoutVar.blocks.PascalCaseName`, where the name is the PascalCase version of the block's `id`. For example, a block with `id: "navbar"` becomes `layoutVar.blocks.Navbar`; `id: "cookie-bar"` becomes `layoutVar.blocks.CookieBar`.

```tsx
function MyLayoutComponent({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col">
      <myLayout.blocks.Navbar />
      <div className="flex-1">{children}</div>
      <myLayout.blocks.Footer />
    </main>
  );
}
```

The component controls the HTML structure — you decide how to wrap and position the blocks and page content. Use Tailwind CSS for styling.

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

1. **File = one layout.** One `.tsx` file per layout in `src/camox/layouts/`. The `id` must match the filename (without `.tsx`).
2. **Named export as `layout`.** Always: `export { myVar as layout }`. Not a default export.
3. **Named function component.** Use `function MyComponent()`, not an arrow function. Reference it in `createLayout` before its declaration is fine (hoisting).
4. **Import path is `"camox/createLayout"`.** The `createLayout` function comes from this import.
5. **Import blocks from `"../blocks/filename"`.** Layout blocks are imported from the blocks directory. Import the named `block` export.
6. **Use Tailwind CSS for the component.** Style the layout shell with Tailwind utility classes. The OG image function uses inline styles instead.
7. **Slot names are PascalCase.** A block with `id: "my-block"` becomes `layout.blocks.MyBlock`.
8. **`buildMetaTitle` is required.** Every layout must define how page titles are constructed.
9. **Description guides layout selection.** Write the `description` to help CMS users choose the right layout for their page — explain what types of pages it's suited for.
10. **Layout blocks should use `layoutOnly: true`.** Blocks intended only for layouts (navbars, footers) should set `layoutOnly: true` in their block definition so they don't clutter the page block picker.
