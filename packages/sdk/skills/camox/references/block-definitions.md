# Creating Camox Block Definitions

A block is a reusable page section (hero, testimonial, gallery, footer...). Users compose pages by assembling blocks. This skill covers creating block **definitions** — the template that describes a block's schema and rendering. Not the content (an instance of a block).

## After defining the block: place it when requested

A definition only adds a new _type_ of block to the catalog — it doesn't put one on any Page. Users almost never just want "a definition"; they want a section that actually shows up on the site. Once the Block Definition exists and the dev server has picked it up, follow the umbrella skill's CLI routing to create a Block on the relevant Page. For shared chrome, follow the Layout Definition reference instead. If the user asks for "a hero on the homepage", define the Block Definition and then create the hero Block on the home Page. Don't stop after the definition unless the user explicitly requested only the reusable type.

## Quick Start

A block file lives in the app's `src/blocks/` folder, is a `.tsx` file, and exports `block`:

```tsx
import { Type, createBlock } from "camox/createBlock";

const myBlock = createBlock({
  id: "my-block", // Must match filename (kebab-case)
  title: "My Block", // Human-readable name
  description: "...", // Tells the AI when/how to use this block
  content: {
    /* ... */
  }, // Editable content schema
  settings: {
    /* ... */
  }, // Optional config toggles
  component: MyBlockComponent,
  toMarkdown: (c) => [`# ${c.title}`, c.description], // Markdown template
});

function MyBlockComponent() {
  return (
    <section>
      <myBlock.Field name="title">{(props) => <h1 {...props} />}</myBlock.Field>
    </section>
  );
}

export { myBlock as block };
```

## DOM integrations in preview and published pages

For DOM listeners, scrolling, browser scripts, or widgets, read [DOM integrations](dom-integrations.md). Preview DOM lives in an iframe; use `getElementContext` from `camox/dom` with a mounted element rather than component-global `window` or `document`.

## The `createBlock` options

| Option        | Required | Description                                                                                                                                                                                                                                                                                                                                                                |
| ------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`          | yes      | Unique kebab-case identifier. Must match the filename without extension.                                                                                                                                                                                                                                                                                                   |
| `title`       | yes      | Display name shown in the CMS UI.                                                                                                                                                                                                                                                                                                                                          |
| `description` | yes      | Tells the AI assistant when to use this block and what content it expects. Write it like guidance for an LLM — be specific about placement, tone, and content guidelines.                                                                                                                                                                                                  |
| `content`     | yes      | An object where each key is a field name and each value is a `Type.*` call. These fields are inline-editable in the CMS.                                                                                                                                                                                                                                                   |
| `settings`    | no       | Same shape as `content`, but for configuration that lives in a settings panel (not inline). Only `Type.Enum` and `Type.Boolean` should be used here.                                                                                                                                                                                                                       |
| `layoutOnly`  | no       | If `true`, the block won't appear in the "add block" sheet — it can only be placed inside layouts (e.g. navbar, footer).                                                                                                                                                                                                                                                   |
| `synced`      | no       | Boolean, defaults to `false`. Share content and settings across every instance of this type within an environment. Ideal for a navbar/footer reused across layouts. Synced blocks have purple editor highlights.                                                                                                                                                           |
| `component`   | yes      | A named React function component that renders the block.                                                                                                                                                                                                                                                                                                                   |
| `toMarkdown`  | yes      | A builder function `(c, s) => (...)[]` that renders block content as markdown. `c` is a proxy typed on your `content` keys; `s` is a proxy typed on your `settings` keys used to wrap lines in conditionals. Each returned entry becomes a paragraph (joined with `\n\n`). Lines where all referenced fields resolve to empty — or whose condition is false — are omitted. |

## Synced blocks (`synced`, optional)

`createBlock({ synced: true, ... })` makes every instance of that block **type** share content and settings, including nested repeater items and their settings. It defaults to `false`: instances are independent unless you opt in. Sharing is scoped to one project environment; development and production never share edits automatically.

Use `layoutOnly: true, synced: true` for a navbar or footer that must have identical data across different layouts. `layoutOnly` controls where a block can be placed; it does **not** enable syncing. A synced block can also be a normal page-content block.

- Editing any instance updates the shared draft data everywhere. New instances reuse existing data rather than resetting it to defaults.
- Positions, page/layout placement, and deletion remain per instance. Deleting one placement doesn't delete the others.
- Publishing a page or layout containing the block publishes its shared data for all live instances. Unpublished draft edits never leak into the live site.
- Enabling syncing on an existing type keeps the oldest instance's data and applies it to the others. Disabling it leaves each instance with a copy that can then be edited independently.
- Synced blocks have **purple highlights and overlays** in the editor.

## Markdown Template (`toMarkdown`)

`toMarkdown` is a builder function that controls how block content is rendered as markdown for AI features (summaries, SEO). It receives:

- `c` — a proxy typed on your `content` keys (`c.title`, `c.description`…)
- `s` — a proxy typed on your `settings` keys, used to wrap lines in conditionals

…and returns an array of entries. Each entry becomes a paragraph (joined with `\n\n`).

A bare `c.fieldName` is the default for single-field lines. Use template literals when combining fields or adding markdown syntax:

```tsx
toMarkdown: (c) => [`# ${c.title}`, c.description, c.cta];
```

**Field resolution rules:**

- **String**: raw text value
- **Link**: `[text](href)`
- **Image**: `![alt](filename)`
- **File**: `[filename](url)`
- **Embed**: raw URL string
- **Repeater**: each item rendered via its own `toMarkdown` (if set on the Repeater options), items joined with `\n\n`
- **ImageList / FileList**: each asset rendered as a markdown bullet
- **Boolean/Enum**: raw string value

Lines where ALL referenced fields resolve to empty are omitted from output.

**Examples:**

```tsx
// Hero block
createBlock({
  toMarkdown: (c) => [`# ${c.title}`, c.description, c.illustration, c.cta],
  content: { ... },
})

// Testimonial — combine fields on one line
createBlock({
  toMarkdown: (c) => [`> ${c.quote}`, `— ${c.author}, ${c.title}, ${c.company}`],
  content: { ... },
})

// Statistics — Repeater with its own toMarkdown
createBlock({
  toMarkdown: (c) => [`## ${c.subtitle}`, c.description, c.statistics],
  content: {
    subtitle: Type.String({ default: "..." }),
    description: Type.String({ default: "..." }),
    statistics: Type.Repeater({
      content: {
        number: Type.String({ default: "100M+" }),
        label: Type.String({ default: "pages served" }),
      },
      minItems: 4,
      maxItems: 8,
      toMarkdown: (c) => [`**${c.number}** — ${c.label}`],
    }),
  },
})
```

The builder is type-safe — accessing a key that doesn't exist on `content` (e.g. `c.titl`) is a TypeScript error.

### Conditional lines from settings

The second `s` argument is a proxy over your `settings` keys. Wrap a line (or array of lines) to make it conditional on a setting:

```tsx
// Boolean setting — include a line only when the setting is true
toMarkdown: (c, s) => [`# ${c.title}`, c.description, s.showCta(c.cta)];

// Boolean wrapping multiple lines — all included together, or all dropped
toMarkdown: (c, s) => [
  `# ${c.title}`,
  s.showDetails([c.subtitle, c.description, c.backgroundImage]),
  c.cta,
];

// Enum — emit different lines depending on the selected variant
toMarkdown: (c, s) => [
  `# ${c.title}`,
  s.variant("banner", `**${c.headline}** — ${c.subtext}`),
  s.variant("inline", `${c.headline}: ${c.cta}`),
];
```

Only `Type.Boolean` and `Type.Enum` settings can be used this way — trying to reference any other setting is a type error. On a `Repeater`'s own `toMarkdown`, `s` refers to the item's own `settings` (not the parent block's).

## Content Field Types

Import `Type` from `"camox/createBlock"`. Every field requires a default value.

### Type.String

Inline-editable text. The workhorse field type. Supports inline formatting and links while remaining a string. For formatting syntax and appearance customization, read [Field styling](field-styling.md).

```tsx
Type.String({
  default: "Hello world", // Required
  title: "Heading", // Optional label
  maxLength: 280, // Optional
  minLength: 1, // Optional
  pattern: "^[A-Z]", // Optional regex
});
```

### Type.Boolean

A toggle. Use in `settings` for config, or in `content` for user-controlled flags.

```tsx
Type.Boolean({ default: false, title: "Show background" });
```

### Type.Enum

A dropdown with predefined options. Most commonly used in `settings`.

```tsx
Type.Enum({
  default: "left",
  options: { left: "Left", center: "Center", right: "Right" },
  title: "Alignment",
});
```

The `default` must be one of the keys in `options`.

### Type.Link

A link with text, URL (or internal page reference), and new-tab toggle. Studio’s Page destination picker includes curated and singleton pages. Curated links store a page ID; singleton links use their fixed internal URL with the existing `type: "external"` URL representation (despite the name, it also supports site-relative URLs). For example: `{ type: "external", href: "/pokedex", text: "Pokédex", newTab: false }`. Inline text links can likewise use `[Pokédex](/pokedex)` and stay in the current tab.

```tsx
Type.Link({
  default: { text: "Learn more", href: "/", newTab: false },
  title: "CTA",
});
```

### Type.Image

A single image — render with `block.Image`.

```tsx
Type.Image({ title: "Cover photo" });
```

### Type.ImageList

A flat array of images — render with `block.ImageList` (NOT `block.Repeater`).

```tsx
Type.ImageList({ defaultItems: 6, title: "Gallery images" });
```

### Type.File

A single file upload, with MIME type filtering — render with `block.File`.

```tsx
Type.File({
  accept: ["application/pdf"],
  title: "PDF Document",
});
```

### Type.FileList

A flat array of files — render with `block.FileList` (NOT `block.Repeater`).

```tsx
Type.FileList({
  accept: ["application/pdf"],
  defaultItems: 0,
  title: "Documents",
});
```

### Type.Embed

A URL validated against a regex pattern. Used for embedding external content.

```tsx
Type.Embed({
  pattern: "https:\\/\\/(www\\.)?(youtube\\.com|youtu\\.be)\\/.+",
  default: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  title: "YouTube URL",
});
```

The `default` must match the `pattern` — an error is thrown at definition time otherwise.

### Type.Repeater

An array of structured items. Each item is an object with its own fields. This is how you create lists of things (testimonials, features, stats, links...).

```tsx
Type.Repeater({
  content: {
    name: Type.String({ default: "Feature" }),
    description: Type.String({ default: "Description" }),
  },
  minItems: 1, // Must be >= 1
  maxItems: 10,
  title: "Features",
  toMarkdown: (c) => [`### ${c.name}`, c.description], // Required markdown template for each item
});
```

The `toMarkdown` option on Repeater defines how each item is rendered as markdown when the parent block's `toMarkdown` references this field. It is required, same as on the block itself.

Repeaters can be nested — an item can contain another Repeater:

```tsx
columns: Type.Repeater({
  content: {
    title: Type.String({ default: "Column" }),
    links: Type.Repeater({
      content: {
        link: Type.Link({ default: { text: "Link", href: "#", newTab: false } }),
      },
      minItems: 1,
      maxItems: 999,
      toMarkdown: (c) => [c.link],
    }),
  },
  minItems: 2,
  maxItems: 4,
  title: "Columns",
  toMarkdown: (c) => [`### ${c.title}`, c.links],
});
```

## Rendering in the Component

The component is a regular React function. It uses methods on the block constant to render each field. Every field renderer uses a render-prop pattern where the child function receives `(props, data)`:

- **`props`** — spread onto the rendered element. Contains HTML/React attributes: refs, data attributes, event handlers, and field-specific attributes like `to`, `src`, `alt`, `children`. **Use `props` in the vast majority of cases.**
- **`data`** (second argument) — raw field values for advanced use cases where `props` doesn't suffice (e.g. conditional styling based on a link's href, using an image URL as a CSS background). Not meant to be spread — treat it as an escape hatch.

### Rendering String fields — `block.Field`

```tsx
<myBlock.Field name="title">{(props) => <h1 {...props} />}</myBlock.Field>
```

The `name` must match a key in `content` that is a `Type.String`. Spread `props` onto the element — `props.children` contains the rendered content. This is what makes the field inline-editable in the CMS.

Camox owns inline markup. To customize inline text, links, or gradients with `textStyle` and `linkStyle`, read [Field styling](field-styling.md).

When the content needs to be placed inside a more complex structure, use `props.children` explicitly:

```tsx
<myBlock.Field name="quote">
  {(props) => <blockquote {...props}>"{props.children}"</blockquote>}
</myBlock.Field>
```

### Rendering Link fields — `block.Link`

Inside the render prop, use the `Link` component from `camox/navigation` instead of a plain `<a>` tag. This enables client-side navigation for internal links. The framework computes `to`, `target`, and `rel` from the link value — just spread `props`.

```tsx
import { Link } from "camox/navigation";

<myBlock.Link name="cta">{(props) => <Link {...props} />}</myBlock.Link>;
```

The optional second argument `data` exposes raw values `{ text, href, newTab }` for custom logic:

```tsx
<myBlock.Link name="cta">
  {(props, { href }) => <Link {...props} className={href === "/" ? "active" : ""} />}
</myBlock.Link>
```

### Rendering Image fields — `block.Image`

```tsx
<myBlock.Image name="cover">{(props) => <img {...props} />}</myBlock.Image>
```

`props` includes `src` and `alt`. The optional `data` argument exposes the raw `ImageValue` for cases like background images:

```tsx
<myBlock.Image name="cover">
  {(_props, { url }) => <div style={{ backgroundImage: `url(${url})` }} />}
</myBlock.Image>
```

### Rendering File fields — `block.File`

```tsx
<myBlock.File name="document">{(props) => <a {...props}>Download</a>}</myBlock.File>
```

`props` includes `href` and `download` (filename). The optional `data` argument exposes the raw `FileValue`.

### Rendering Embed fields — `block.Embed`

```tsx
<myBlock.Embed name="videoUrl">{(props) => <iframe {...props} />}</myBlock.Embed>
```

`props` includes `src`. The optional `data` argument exposes `{ url }` for cases where the URL needs transformation:

```tsx
<myBlock.Embed name="videoUrl">
  {(_props, { url }) => <iframe src={transformUrl(url)} />}
</myBlock.Embed>
```

### Rendering Repeater fields — `block.Repeater`

```tsx
<myBlock.Repeater name="features">
  {(item) => (
    <div>
      <item.Field name="name">{(props) => <h3 {...props} />}</item.Field>
      <item.Field name="description">{(props) => <p {...props} />}</item.Field>
    </div>
  )}
</myBlock.Repeater>
```

Inside a Repeater, the `item` callback argument exposes the same `.Field`, `.Link`, `.Image`, `.File`, `.Embed`, `.ImageList`, `.FileList`, and `.Repeater` methods — scoped to that item. This is how nested repeaters work too:

```tsx
<footer.Repeater name="columns">
  {(column) => (
    <column.Repeater name="links">
      {(linkItem) => <linkItem.Link name="link">{(props) => <Link {...props} />}</linkItem.Link>}
    </column.Repeater>
  )}
</footer.Repeater>
```

### Image and File lists — `block.ImageList` / `block.FileList`

For `Type.ImageList` use `block.ImageList`; for `Type.FileList` use `block.FileList` (NOT `block.Repeater`). The render-prop is the same shape as `block.Image` / `block.File` — `(props, data) => …` — invoked once per asset:

```tsx
// Top-level
<gallery.ImageList name="images">
  {(props) => <img {...props} className="rounded-lg" />}
</gallery.ImageList>

// Nested inside a Type.Repeater
<paragraphGrid.Repeater name="paragraphs">
  {(item) => (
    <item.ImageList name="logos">
      {(props) => <img {...props} className="size-10 object-contain" />}
    </item.ImageList>
  )}
</paragraphGrid.Repeater>
```

`Repeater` is only for `Type.Repeater` arrays. Trying to use `Repeater` on an `ImageList` / `FileList` is a TypeScript error.

### Reading settings — `block.useSetting`

```tsx
function MyComponent() {
  const theme = myBlock.useSetting("theme");
  const compact = myBlock.useSetting("compact");
  // Use these values in your JSX for conditional rendering/styling
}
```

### Detached rendering — `block.Detached`

Renders content outside the block's DOM container. Useful for fixed/floating elements like sticky navbars or modals. Uses a render prop that provides `props` with `ref`, `onClick`, `onMouseEnter`, and `onMouseLeave` — spread these onto the root element.

```tsx
<myBlock.Detached>
  {(props) => (
    <div {...props} className="fixed top-0 left-0 right-0 z-50">
      {/* floating content */}
    </div>
  )}
</myBlock.Detached>
```

## Rules and Conventions

1. **File = one block.** One `.tsx` file per block in `src/blocks/`. The `id` must match the filename (without `.tsx`).
2. **Named export as `block`.** Always: `export { myVar as block }`. Not a default export.
3. **Named function component.** Use `function MyComponent()`, not an arrow function. Reference it in `createBlock` before its declaration is fine (hoisting).
4. **All fields need defaults.** Every `Type.*` call requires a default value (images and files get automatic placeholders).
5. **Description is for the AI.** Write the `description` as guidance for an LLM — explain when to use this block, what kind of content it's for, and where it fits on a page.
6. **`toMarkdown` is required.** Every block must define how its content renders as markdown. Use the builder function `(c) => [...]` and reference content fields via `c.fieldName`.
7. **Settings = Enum and Boolean only.** Keep settings simple. Use `content` for everything the user edits inline.
8. **Repeater minItems >= 1.** You can't have an empty repeater — there's always at least one item.
9. **Import path is `"camox/createBlock"`.** Both `Type` and `createBlock` come from this import.
10. **Use Tailwind CSS for styling.** All example blocks use Tailwind utility classes. Follow the same patterns: `container mx-auto px-4` for centered content, responsive breakpoints, etc.
