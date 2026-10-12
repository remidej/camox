# Artifacts

An **artifact** is a field whose content is a self-contained web page (its **artifact source**), usually written by an agent and rendered in a sandboxed `<iframe>`. Artifacts hold bespoke visuals and interactions that blocks can't express: animated SVGs, 3D scenes, small interactive widgets.

## Artifact or block?

Pick an artifact when the element is really code: a one-off visual whose value is in how it moves or responds, which editors would never restructure. Pick a block for anything editors write, reorder, or reuse: headings, copy, links, images, lists, cards. Keep that content in the block's fields, around the artifact, so editors and agents can still read and change it.

A definition that would fit one place on one site, or settings bolted on only to make a visual look reusable, is the signal for an artifact. Text that matters for SEO or Markdown belongs in fields, never inside the source: Camox treats the source as opaque and only reads its `<title>`.

## Declare and render

```tsx
content: (field) => ({
  heading: field.string({ default: "How it works" }),
  visual: field.artifact({ size: "fill", title: "Diagram" }),
}),
```

- `size` (required): `"fill"` fills a container whose size the block controls, for example with an aspect ratio; `"content"` is for frames whose height follows their page, such as calculators.
- `default` (optional): a starting source. Leave it out; agents write sources as content. An empty artifact renders nothing on the website and a placeholder in the studio preview.
- Artifacts work in block content and repeater items, so also in layout and synced blocks. Collection records can't hold them.

```tsx
<div className="aspect-video">
  <block.Artifact name="visual">
    {(props) => <iframe {...props} className="size-full" />}
  </block.Artifact>
</div>
```

Spread the props onto your own `<iframe>`: they carry `srcDoc`, `sandbox="allow-scripts"`, `allow="fullscreen; clipboard-write"`, `title`, `loading="lazy"`, and a `ref` that connects the frame to the `camox` runtime. Don't replace the `ref`. Repeater items use `item.Artifact`. `block.Field` rejects artifact fields.

## Write a source

Write the source to a local file and push it with `blocks edit --id <ID> --field-file <NAME>=<PATH>` (or `blocks create`), then check it with `camox preview`; see [Set string fields from files](cli-content.md#set-string-fields-from-files). `blocks describe` lists artifact fields with `fieldType: "Artifact"` and their `size`.

- **Under 256 KB.** Larger writes are rejected. Load libraries from a CDN instead of inlining them.
- **Import from esm.sh with exact pinned versions**, so the artifact never changes under the website:

  ```html
  <script type="module">
    import { animate } from "https://esm.sh/motion@12.23.12";
  </script>
  ```

- **A meaningful `<title>`.** It names the frame for screen readers and is the artifact's Markdown Representation. Without one, the artifact is called "Untitled artifact", and `blocks create` and `blocks edit` return a warning.
- **Respect `prefers-reduced-motion`** with the native media query, in CSS (`@media (prefers-reduced-motion: reduce)`) and in scripts (`matchMedia`), by stopping or simplifying motion.
- **Fonts on the website's own domain need CORS headers.** The sandbox gives the page an opaque origin, so self-hosted fonts load only when the server sends `Access-Control-Allow-Origin: *` for them.

## The `camox` runtime

Camox injects a small runtime at the top of every source, before anything in it runs. It's how an artifact receives what its sandbox hides from it. `window.camox` always exists, so use it directly, without feature detection.

Never implement your own `postMessage` protocol with the page. The website and the studio talk to artifacts only through `camox`, and nothing on the page listens for other messages.

### `camox.studio`

`null` on the website. Inside the studio, an object describing where the artifact is shown:

- `editMode`: `true` while an editor has Edit Mode on.
- `canvas`: `true` on the Canvas, where pages and blocks are laid out side by side.

```js
const editing = window.camox.studio?.editMode === true;
```

Read it when you act rather than once at startup: it's `null` until the frame connects, and it changes when the editor toggles Edit Mode. Use it to stay calm while someone is editing, for example by not autoplaying sound.

### Theme: `camox.theme` and `camox.onTheme`

Artifacts match the website automatically. The website's theme tokens (its CSS custom properties, such as `--background` or `--primary`) are applied to the artifact's `:root`, with the values that apply where the artifact sits on the page: inside a `.dark` section, an artifact gets the dark values. When the website's theme changes, for example when a visitor toggles dark mode, the tokens are applied again. Style with the tokens and CSS needs nothing else:

```css
body {
  background: var(--background);
  color: var(--foreground);
}
```

`camox.theme` holds the same tokens for scripts:

- `tokens`: each token's raw value, such as `{ "--primary": "oklch(0.55 0.2 260)", "--radius": "0.5rem" }`.
- `colors`: each color token as sRGB channels from 0 to 255, such as `{ "--primary": { r: 37, g: 99, b: 235 } }`, including tokens written in `oklch()`. Use these for canvas, three.js or WebGL, which can't read CSS variables.

`camox.onTheme(callback)` calls `callback(theme)` whenever the tokens change, and returns a function that unsubscribes. It isn't called for the theme the artifact already has, so draw once with `camox.theme`, then on each change:

```js
const draw = ({ colors }) => {
  const { r, g, b } = colors["--primary"];
  material.color.setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
};
draw(window.camox.theme);
window.camox.onTheme(draw);
```

- **The body starts hidden.** It stays invisible until the first theme arrives, so the artifact never shows in the wrong colors. If no theme comes, it shows after a short timeout. Don't fight this by forcing `visibility` on `body`.
- **Never use `prefers-color-scheme`** to pick light or dark. Inside the frame it follows the visitor's OS, not the website, which may be dark on a light OS or the reverse. Rely on the tokens.
- **Fonts.** The website's font stylesheets and preconnect links from its document definition are loaded before your source, so its fonts work from the first render. Use the website's font family names, or the tokens that hold them.

The runtime API has no stability guarantee while Camox is pre-1.0.
