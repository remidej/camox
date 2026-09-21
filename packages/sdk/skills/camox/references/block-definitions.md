# Creating Camox Block Definitions

A block definition specifies a reusable section's schema and rendering, not an instance's content.

When asked to add a section, also place an instance after dev-server discovery using the [CLI workflow](../SKILL.md#content-and-cli). For shared chrome, use [Layout Definitions](layout-definitions.md) instead. Defining a type alone does not place it on a Page.

## Quick Start

Use one `.tsx` file per block in `src/blocks/`, a named `block` export (not default), a named function component, and Tailwind styling.

```tsx
import { Type, createBlock } from "camox/createBlock";

const myBlock = createBlock({
  id: "my-block",
  title: "My Block",
  description: "A page introduction with an editable heading.",
  content: {
    title: Type.String({ default: "Welcome" }),
  },
  component: MyBlockComponent,
  toMarkdown: (c) => [`# ${c.title}`],
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

For DOM listeners, scrolling, scripts, or widgets, read [DOM integrations](dom-integrations.md). Preview DOM lives in an iframe; use `getElementContext` from `camox/dom`, not component-global `window` or `document`.

## The `createBlock` options

| Option        | Required | Description                                                                                   |
| ------------- | -------- | --------------------------------------------------------------------------------------------- |
| `id`          | yes      | Unique kebab-case identifier matching the filename without extension.                         |
| `title`       | yes      | CMS display name.                                                                             |
| `description` | yes      | Agent guidance on placement, expected content, and tone.                                      |
| `content`     | yes      | Field names mapped to `Type.*` schemas for editable content.                                  |
| `settings`    | no       | Settings-panel fields; only `Type.Enum` and `Type.Boolean`.                                   |
| `layoutOnly`  | no       | If true, restricts placement to layouts and hides the type from the add-block picker.         |
| `synced`      | no       | Defaults to false. Shares content/settings across instances within an environment; see below. |
| `component`   | yes      | Named React function component.                                                               |
| `toMarkdown`  | yes      | `(c, s) => [...]` markdown builder; see below.                                                |

## Synced blocks (`synced`, optional)

`synced: true` shares content and settings, including nested repeater items and their settings, across every instance of the block **type** within one environment. Dev and production remain independent. Synced blocks have purple editor highlights.

For shared navbar/footer data across layouts, use `layoutOnly: true, synced: true`. These flags are independent: synced blocks can also be ordinary page-content blocks.

- Editing any instance updates the shared draft everywhere. New instances reuse existing data rather than resetting to defaults.
- Position, placement, and deletion remain per instance; deleting one placement leaves the others.
- Publishing a page or layout containing the block publishes shared data for all live instances. Unpublished drafts do not leak into live.
- Enabling syncing on an existing type applies the oldest instance's data to all instances. Disabling it leaves independently editable copies.

## Markdown Template (`toMarkdown`)

Required on blocks and repeaters. Receives typed proxies `c` (content) and `s` (settings); returns entries joined with `\n\n` for AI summaries and SEO. Lines whose referenced fields are all empty, or whose condition is false, are omitted.

Use bare `c.field` for single-field lines and template literals for markdown or combined fields:

```tsx
toMarkdown: (c) => [`> ${c.quote}`, `— ${c.author}, ${c.company}`, c.photo];
```

Field resolution:

| Type                 | Markdown                                         |
| -------------------- | ------------------------------------------------ |
| String               | Raw text                                         |
| Link                 | `[text](href)`                                   |
| Image                | `![alt](filename)`                               |
| File                 | `[filename](url)`                                |
| Embed                | Raw URL                                          |
| Repeater             | Each item's own `toMarkdown`, joined with `\n\n` |
| ImageList / FileList | One markdown bullet per asset                    |
| Boolean / Enum       | Raw string value                                 |

### Conditional lines from settings

Boolean settings wrap one line or an array; Enum settings match a variant:

```tsx
toMarkdown: (c, s) => [
  `# ${c.title}`,
  s.showCta(c.cta),
  s.showDetails([c.subtitle, c.description]),
  s.variant("banner", `**${c.headline}** — ${c.subtext}`),
  s.variant("inline", `${c.headline}: ${c.cta}`),
];
```

Only Boolean/Enum settings support these conditionals. A repeater's `s` refers to the item's settings, not the parent block's.

## Content Field Types

Import `Type` from `"camox/createBlock"`. Supply defaults for scalar fields; images/files get automatic placeholders, lists use `defaultItems`, and repeaters use their item schemas and bounds.

### Type.String

Inline-editable text supporting formatting and links while remaining a string. See [Field styling](field-styling.md) for formatting syntax and appearance customization.

```tsx
Type.String({
  default: "Hello world",
  title: "Heading", // Optional label
  maxLength: 280, // Optional
  minLength: 1, // Optional
  pattern: "^[A-Z]", // Optional regex
});
```

### Type.Boolean and Type.Enum

Use in `settings` for configuration or `content` for editable values. Enum defaults must match an option key.

```tsx
Type.Boolean({ default: false, title: "Show background" });
Type.Enum({
  default: "left",
  options: { left: "Left", center: "Center", right: "Right" },
  title: "Alignment",
});
```

### Type.Link

Text, destination, and new-tab toggle. Curated page links store page IDs; singleton links store fixed URLs using the existing `type: "external"` representation, which also supports site-relative URLs: `{ type: "external", href: "/pokedex", text: "Pokédex", newTab: false }`. Both page kinds appear in Studio's destination picker. Inline `[Pokédex](/pokedex)` links stay in the current tab.

```tsx
Type.Link({
  default: { text: "Learn more", href: "/", newTab: false },
  title: "CTA",
});
```

### Images and files

Files support MIME filtering. Render each type with its matching helper; asset lists are **not** repeaters.

```tsx
Type.Image({ title: "Cover photo" });
Type.ImageList({ defaultItems: 6, title: "Gallery images" });
Type.File({ accept: ["application/pdf"], title: "PDF Document" });
Type.FileList({ accept: ["application/pdf"], defaultItems: 0, title: "Documents" });
```

### Type.Embed

A URL validated against a regex. A nonmatching default throws at definition time.

```tsx
Type.Embed({
  pattern: "https:\\/\\/(www\\.)?(youtube\\.com|youtu\\.be)\\/.+",
  default: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  title: "YouTube URL",
});
```

### Type.Repeater

Structured items with their own content, optional settings, and required `toMarkdown`. `minItems` must be at least 1; repeaters cannot be empty. Nest repeaters in an item's `content` when needed.

```tsx
Type.Repeater({
  content: {
    name: Type.String({ default: "Feature" }),
    description: Type.String({ default: "Description" }),
  },
  minItems: 1,
  maxItems: 10,
  title: "Features",
  toMarkdown: (c) => [`### ${c.name}`, c.description],
});
```

Reference the repeater field in the parent block's `toMarkdown` to include its rendered items.

## Rendering in the Component

Field renderers receive `(props, data)`:

- **Spread `props` onto the element** to preserve editor refs, attributes, and handlers, plus field-specific values such as `children`, `to`, `src`, and `alt`.
- `data` is the raw field value for custom logic, not an object to spread. Prefer `props`; use raw data only where needed.

### Strings — `block.Field`

`name` must select a `Type.String` field. `props.children` contains Camox's rendered inline markup.

```tsx
<myBlock.Field name="title">{(props) => <h1 {...props} />}</myBlock.Field>

<myBlock.Field name="quote">
  {(props) => <blockquote {...props}>"{props.children}"</blockquote>}
</myBlock.Field>
```

For `textStyle` and `linkStyle`, read [Field styling](field-styling.md).

### Links — `block.Link`

Use `Link` from `camox/navigation`, not `<a>`, for client-side internal navigation. `props` supplies `to`, `target`, and `rel`; raw `data` exposes `{ text, href, newTab }`.

```tsx
import { Link } from "camox/navigation";

<myBlock.Link name="cta">{(props) => <Link {...props} />}</myBlock.Link>;
```

### Images, files, and embeds

```tsx
<myBlock.Image name="cover">{(props) => <img {...props} />}</myBlock.Image>
<myBlock.File name="document">{(props) => <a {...props}>Download</a>}</myBlock.File>
<myBlock.Embed name="videoUrl">{(props) => <iframe {...props} />}</myBlock.Embed>
```

- Image: `props` includes `src`/`alt`; `data` is `ImageValue`.
- File: `props` includes `href`/`download` (filename); `data` is `FileValue`.
- Embed: `props` includes `src`; `data` is `{ url }`, available for URL transformation.

### Repeaters — `block.Repeater`

The callback receives an item-scoped API with the same `.Field`, `.Link`, `.Image`, `.File`, `.Embed`, `.ImageList`, `.FileList`, and `.Repeater` methods.

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

Nested repeaters use the item-scoped `.Repeater`:

```tsx
<footer.Repeater name="columns">
  {(column) => (
    <column.Repeater name="links">
      {(item) => <item.Link name="link">{(props) => <Link {...props} />}</item.Link>}
    </column.Repeater>
  )}
</footer.Repeater>
```

### Asset lists — `block.ImageList` / `block.FileList`

Use the matching helper, **not `block.Repeater`**. Its `(props, data)` callback runs once per asset, with the same shape as `.Image` / `.File`. These helpers also work on repeater items.

```tsx
<gallery.ImageList name="images">
  {(props) => <img {...props} className="rounded-lg" />}
</gallery.ImageList>
```

### Settings — `block.useSetting`

Read settings inside the component with `myBlock.useSetting("theme")`.

### Detached rendering — `block.Detached`

Renders outside the block's DOM container for fixed/floating elements. Spread its `props` (`ref`, `onClick`, `onMouseEnter`, `onMouseLeave`) onto the root element.

```tsx
<myBlock.Detached>
  {(props) => (
    <div {...props} className="fixed top-0 left-0 right-0 z-50">
      {/* floating content */}
    </div>
  )}
</myBlock.Detached>
```
