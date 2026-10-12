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

Set the source like any other string field through the CLI (see [CLI Content](cli-content.md)); `blocks describe` lists artifact fields with `fieldType: "Artifact"` and their `size`.

- **Under 256 KB.** Larger writes are rejected. Load libraries from a CDN instead of inlining them.
- **Import from esm.sh with exact pinned versions**, so the artifact never changes under the website:

  ```html
  <script type="module">
    import { animate } from "https://esm.sh/motion@12.23.12";
  </script>
  ```

- **A meaningful `<title>`.** It names the frame for screen readers and is the artifact's Markdown Representation. Without one, the artifact is called "Untitled artifact".
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

The runtime API has no stability guarantee while Camox is pre-1.0.
