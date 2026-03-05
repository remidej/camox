---
name: camox-block
description: "How to create Camox block definition files. Use this skill whenever the user wants to create a new block for their Camox website, add a page section/component, build a reusable content block, or asks about the block definition API. Trigger on mentions of blocks, sections, page components, content types, or any request to add new visual sections to a Camox site — even if they don't say 'block' explicitly."
---

# Creating Camox Block Definitions

A block is a reusable page section (hero, testimonial, gallery, footer...). Users compose pages by assembling blocks. This skill covers creating block **definitions** — the template that describes a block's schema and rendering. Not the content (an instance of a block).

## Quick Start

A block file lives in the app's `src/blocks/` folder, is a `.tsx` file, and exports `block`:

```tsx
import { Type, createBlock } from "camox/createBlock";

const myBlock = createBlock({
  id: "my-block",           // Must match filename (kebab-case)
  title: "My Block",        // Human-readable name
  description: "...",       // Tells the AI when/how to use this block
  content: { /* ... */ },   // Editable content schema
  settings: { /* ... */ },  // Optional config toggles
  component: MyBlockComponent,
});

function MyBlockComponent() {
  return (
    <section>
      <myBlock.Field name="title">
        {(content) => <h1>{content}</h1>}
      </myBlock.Field>
    </section>
  );
}

export { myBlock as block };
```

## The `createBlock` options

| Option | Required | Description |
|---|---|---|
| `id` | yes | Unique kebab-case identifier. Must match the filename without extension. |
| `title` | yes | Display name shown in the CMS UI. |
| `description` | yes | Tells the AI assistant when to use this block and what content it expects. Write it like guidance for an LLM — be specific about placement, tone, and content guidelines. |
| `content` | yes | An object where each key is a field name and each value is a `Type.*` call. These fields are inline-editable in the CMS. |
| `settings` | no | Same shape as `content`, but for configuration that lives in a settings panel (not inline). Only `Type.Enum` and `Type.Boolean` should be used here. |
| `layoutOnly` | no | If `true`, the block won't appear in the "add block" sheet — it can only be placed inside layouts (e.g. navbar, footer). |
| `component` | yes | A named React function component that renders the block. |

## Content Field Types

Import `Type` from `"camox/createBlock"`. Every field requires a default value.

### Type.String

Inline-editable text. The workhorse field type.

```tsx
Type.String({
  default: "Hello world",   // Required
  title: "Heading",         // Optional label
  maxLength: 280,           // Optional
  minLength: 1,             // Optional
  pattern: "^[A-Z]",        // Optional regex
})
```

### Type.Boolean

A toggle. Use in `settings` for config, or in `content` for user-controlled flags.

```tsx
Type.Boolean({ default: false, title: "Show background" })
```

### Type.Enum

A dropdown with predefined options. Most commonly used in `settings`.

```tsx
Type.Enum({
  default: "left",
  options: { left: "Left", center: "Center", right: "Right" },
  title: "Alignment",
})
```

The `default` must be one of the keys in `options`.

### Type.Link

A link with text, URL (or internal page reference), and new-tab toggle.

```tsx
Type.Link({
  default: { text: "Learn more", href: "/", newTab: false },
  title: "CTA",
})
```

### Type.Image

A single image, or a repeatable array of images.

```tsx
// Single image
Type.Image({ title: "Cover photo" })

// Multiple images (creates a repeatable list)
Type.Image({ multiple: true, defaultItems: 6, title: "Gallery images" })
```

### Type.File

A file upload, with MIME type filtering.

```tsx
Type.File({
  accept: ["application/pdf"],
  title: "PDF Document",
})

// Multiple files
Type.File({
  accept: ["application/pdf"],
  multiple: true,
  defaultItems: 0,
  title: "Documents",
})
```

### Type.Embed

A URL validated against a regex pattern. Used for embedding external content.

```tsx
Type.Embed({
  pattern: "https:\\/\\/(www\\.)?(youtube\\.com|youtu\\.be)\\/.+",
  default: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  title: "YouTube URL",
})
```

The `default` must match the `pattern` — an error is thrown at definition time otherwise.

### Type.RepeatableObject

An array of structured items. Each item is an object with its own fields. This is how you create lists of things (testimonials, features, stats, links...).

```tsx
Type.RepeatableObject(
  {
    name: Type.String({ default: "Feature" }),
    description: Type.String({ default: "Description" }),
  },
  {
    minItems: 1,    // Must be >= 1
    maxItems: 10,
    title: "Features",
  }
)
```

RepeatableObjects can be nested — an item can contain another RepeatableObject:

```tsx
columns: Type.RepeatableObject(
  {
    title: Type.String({ default: "Column" }),
    links: Type.RepeatableObject(
      {
        link: Type.Link({ default: { text: "Link", href: "#", newTab: false } }),
      },
      { minItems: 1, maxItems: 999 }
    ),
  },
  { minItems: 2, maxItems: 4, title: "Columns" }
)
```

## Rendering in the Component

The component is a regular React function. It uses methods on the block constant to render each field. The pattern is always: use the appropriate renderer for each field type, with a render-prop child that receives the field value.

### Rendering String fields — `block.Field`

```tsx
<myBlock.Field name="title">
  {(content) => <h1>{content}</h1>}
</myBlock.Field>
```

The `name` must match a key in `content` that is a `Type.String`. The `content` argument is a string. This is what makes the field inline-editable in the CMS.

### Rendering Link fields — `block.Link`

Inside the render prop, use the `Link` component from `@tanstack/react-router` instead of a plain `<a>` tag. This enables client-side navigation for internal links.

```tsx
import { Link } from "@tanstack/react-router";

<myBlock.Link name="cta">
  {({ text, href, newTab }) => (
    <Link
      to={href}
      target={newTab ? "_blank" : undefined}
      rel={newTab ? "noreferrer" : undefined}
    >
      {text}
    </Link>
  )}
</myBlock.Link>
```

### Rendering Image fields — `block.Image`

```tsx
<myBlock.Image name="cover">
  {(img) => <img src={img.url} alt={img.alt} />}
</myBlock.Image>
```

### Rendering File fields — `block.File`

```tsx
<myBlock.File name="document">
  {(file) => <a href={file.url} download={file.filename}>Download</a>}
</myBlock.File>
```

### Rendering Embed fields — `block.Embed`

```tsx
<myBlock.Embed name="videoUrl">
  {(url) => <iframe src={url} />}
</myBlock.Embed>
```

### Rendering RepeatableObject fields — `block.Repeater`

```tsx
<myBlock.Repeater name="features">
  {(item) => (
    <div>
      <item.Field name="name">
        {(content) => <h3>{content}</h3>}
      </item.Field>
      <item.Field name="description">
        {(content) => <p>{content}</p>}
      </item.Field>
    </div>
  )}
</myBlock.Repeater>
```

Inside a Repeater, the `item` callback argument exposes the same `.Field`, `.Link`, `.Image`, `.File`, `.Embed`, and `.Repeater` methods — scoped to that item. This is how nested repeaters work too:

```tsx
<footer.Repeater name="columns">
  {(column) => (
    <column.Repeater name="links">
      {(linkItem) => (
        <linkItem.Link name="link">
          {({ text, href }) => <a href={href}>{text}</a>}
        </linkItem.Link>
      )}
    </column.Repeater>
  )}
</footer.Repeater>
```

For `Type.Image({ multiple: true })`, the repeater item has a single `image` key:

```tsx
<gallery.Repeater name="images">
  {(item) => (
    <item.Image name="image">
      {(img) => <img src={img.url} alt={img.alt} />}
    </item.Image>
  )}
</gallery.Repeater>
```

### Reading settings — `block.useSetting`

```tsx
function MyComponent() {
  const theme = myBlock.useSetting("theme");
  const compact = myBlock.useSetting("compact");
  // Use these values in your JSX for conditional rendering/styling
}
```

### Detached rendering — `block.Detached`

Renders content outside the block's DOM container. Useful for fixed/floating elements like sticky navbars or modals.

```tsx
<myBlock.Detached>
  <div className="fixed top-0 left-0 right-0 z-50">
    {/* floating content */}
  </div>
</myBlock.Detached>
```

## Rules and Conventions

1. **File = one block.** One `.tsx` file per block in `src/blocks/`. The `id` must match the filename (without `.tsx`).
2. **Named export as `block`.** Always: `export { myVar as block }`. Not a default export.
3. **Named function component.** Use `function MyComponent()`, not an arrow function. Reference it in `createBlock` before its declaration is fine (hoisting).
4. **All fields need defaults.** Every `Type.*` call requires a default value (images and files get automatic placeholders).
5. **Description is for the AI.** Write the `description` as guidance for an LLM — explain when to use this block, what kind of content it's for, and where it fits on a page.
6. **Settings = Enum and Boolean only.** Keep settings simple. Use `content` for everything the user edits inline.
7. **RepeatableObject minItems >= 1.** You can't have an empty repeatable — there's always at least one item.
8. **Import path is `"camox/createBlock"`.** Both `Type` and `createBlock` come from this import.
9. **Use Tailwind CSS for styling.** All example blocks use Tailwind utility classes. Follow the same patterns: `container mx-auto px-4` for centered content, responsive breakpoints, etc.
